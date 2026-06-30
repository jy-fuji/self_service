"""Turn a natural-language request into a grounded, schema-valid plan.

Live mode  : Azure OpenAI with Structured Outputs (strict JSON schema) +
             the retrieved standards injected as grounding.
Offline    : a deterministic classifier that mirrors the same rules.

In both cases the LLM/classifier only chooses *what* (env, team, region, sku,
count). The deterministic `build_resources()` assigns globally-unique names,
tags, cost and citations — so output is reproducible and policy-shaped.
"""
import re
import json
import uuid

from .config import cfg
from . import standards

KNOWN_TEAMS = ["retail-analytics", "onboarding", "ml-research"]

PLAN_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "environment": {"type": "string", "enum": ["dev", "test", "prod"]},
        "owner_team": {"type": "string"},
        "region": {"type": "string", "enum": ["westus2", "eastus", "southeastasia"]},
        "summary": {"type": "string"},
        "resources": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "logical_name": {"type": "string"},
                    "kind": {"type": "string", "enum": ["storage_account"]},
                    "sku": {"type": "string",
                            "enum": ["Standard_LRS", "Standard_GRS", "Standard_ZRS", "Standard_RAGRS"]},
                    "purpose": {"type": "string"},
                },
                "required": ["logical_name", "kind", "sku", "purpose"],
            },
        },
    },
    "required": ["environment", "owner_team", "region", "summary", "resources"],
}

SYSTEM = """You are a self-service infrastructure provisioning agent for Azure.
You ground EVERY choice in the retrieved organisation standards provided to you.
Rules:
- Only plan storage_account resources (the approved v1 catalogue).
- Choose the environment, owning team, region and SKU strictly from the standards.
- dev is limited to Standard_LRS; test/prod may use a redundant SKU.
- Apply the team's default region and cost centre from the team overrides unless the user is explicit.
- Never invent a region or SKU that is not in the allowed lists.
- Pick a small number of resources (1-3) that satisfies the request.
- logical_name is a short identifier like st01, st02 (NOT the final Azure name).
Return ONLY the structured plan."""


def _detect(text):
    t = text.lower()
    env = "prod" if re.search(r"\bprod|production\b", t) else \
          "test" if re.search(r"\btest|testing|staging\b", t) else "dev"
    team = next((k for k in KNOWN_TEAMS if k in t), None)
    if not team:
        team = "retail-analytics"
    # count
    count = 1
    m = re.search(r"\b(two|three|2|3|four|4)\b", t)
    words = {"two": 2, "three": 3, "four": 4, "2": 2, "3": 3, "4": 4}
    if m:
        count = words.get(m.group(1), 1)
    elif re.search(r"accounts|buckets", t):
        count = 2
    return env, team, max(1, min(count, 3))


def _offline_plan(text):
    env, team, count = _detect(text)
    defaults = standards.TEAM_DEFAULTS.get(team, {"region": "westus2"})
    region = defaults["region"]
    if region not in standards.ALLOWED_REGIONS[env]:
        region = standards.ALLOWED_REGIONS[env][0]
    sku = standards.SKU_BY_ENV[env]
    resources = [{"logical_name": f"st{i+1:02d}", "kind": "storage_account",
                  "sku": sku, "purpose": "object storage for the requested workload"}
                 for i in range(count)]
    return {"environment": env, "owner_team": team, "region": region,
            "summary": f"{count} {sku} storage account(s) for {team} in {region} ({env}).",
            "resources": resources}


# Remember which API surface actually worked, so 'auto' doesn't probe every call.
_RESOLVED = {"style": None}


def _is_reasoning(name):
    n = (name or "").lower()
    return ("gpt-5" in n) or n.startswith(("o1", "o3", "o4"))


def _chat_client():
    from .config import ensure_truststore
    ensure_truststore()
    from openai import AzureOpenAI
    return AzureOpenAI(azure_endpoint=cfg.AOAI_ENDPOINT, api_key=cfg.AOAI_KEY,
                       api_version=cfg.AOAI_API_VERSION)


def _call_responses(client, instructions, user):
    kwargs = dict(model=cfg.AOAI_CHAT_DEPLOYMENT, instructions=instructions, input=user,
                  max_output_tokens=cfg.AOAI_MAX_OUTPUT_TOKENS,
                  text={"format": {"type": "json_schema", "name": "provisioning_plan",
                                   "schema": PLAN_SCHEMA, "strict": True}})
    if cfg.AOAI_REASONING_EFFORT:
        kwargs["reasoning"] = {"effort": cfg.AOAI_REASONING_EFFORT}
    r = client.responses.create(**kwargs)
    return r.output_text


def _call_chat(client, instructions, user):
    kwargs = dict(model=cfg.AOAI_CHAT_DEPLOYMENT,
                  messages=[{"role": "system", "content": instructions},
                            {"role": "user", "content": user}],
                  max_completion_tokens=cfg.AOAI_MAX_OUTPUT_TOKENS,
                  response_format={"type": "json_schema",
                                   "json_schema": {"name": "provisioning_plan", "strict": True,
                                                   "schema": PLAN_SCHEMA}})
    if not _is_reasoning(cfg.AOAI_CHAT_DEPLOYMENT):
        kwargs["temperature"] = 0
    r = client.chat.completions.create(**kwargs)
    return r.choices[0].message.content


def _live_plan(text, grounding):
    client = _chat_client()
    ground_text = "\n".join(f"- [{c['id']}] {c['text']}" for c in grounding)
    user = (f"Retrieved organisation standards (ground your plan in these):\n{ground_text}\n\n"
            f"Request: {text}")
    style = _RESOLVED["style"] or cfg.AOAI_API_STYLE
    content = None
    if style in ("auto", "responses"):
        try:
            content = _call_responses(client, SYSTEM, user)
            _RESOLVED["style"] = "responses"
        except Exception:
            if style == "responses":
                raise
            content = None  # fall through to chat in 'auto'
    if content is None:
        content = _call_chat(client, SYSTEM, user)
        _RESOLVED["style"] = "chat"

    plan = json.loads(content)
    # safety clamps
    env = plan.get("environment", "dev")
    if plan.get("region") not in standards.ALLOWED_REGIONS.get(env, ["westus2"]):
        plan["region"] = standards.ALLOWED_REGIONS.get(env, ["westus2"])[0]
    if env == "dev":
        for r in plan.get("resources", []):
            r["sku"] = "Standard_LRS"
    plan["resources"] = plan.get("resources", [])[:3] or _offline_plan(text)["resources"]
    return plan


def make_plan(text, grounding):
    """Return a plan spec dict. Falls back to offline on any live error."""
    if cfg.llm_live:
        try:
            return _live_plan(text, grounding)
        except Exception as e:  # noqa: BLE001 - never break the demo on an LLM hiccup
            plan = _offline_plan(text)
            plan["summary"] += "  (planner fell back to offline mode)"
            plan["_warning"] = str(e)
            return plan
    return _offline_plan(text)


def _storage_name(env, team, idx):
    short = re.sub(r"[^a-z0-9]", "", team.lower())[:8]
    suffix = uuid.uuid4().hex[:5]
    base = f"{env}{short}st{idx:02d}{suffix}"
    return re.sub(r"[^a-z0-9]", "", base.lower())[:24]


def build_resources(plan):
    """Materialise a plan spec into front-end resource objects with names,
    tags, cost and citations. Names are deterministic-format but unique."""
    env = plan["environment"]
    team = plan["owner_team"]
    region = plan["region"]
    cc = standards.TEAM_DEFAULTS.get(team, {}).get("cost_center", "CC-0000")
    tier = "bronze" if env == "dev" else "silver"
    resources = []
    for i, r in enumerate(plan["resources"], start=1):
        sku = r.get("sku", standards.SKU_BY_ENV[env])
        name = _storage_name(env, team, i)
        resources.append({
            "logical_name": r.get("logical_name", f"st{i:02d}"),
            "kind": "storage_account",
            "module": "Microsoft.Storage/storageAccounts",
            "avm_module": "Microsoft.Storage/storageAccounts@2023-01-01",
            "params": {"skuName": sku, "kind": "StorageV2", "location": region},
            "naming": name,
            "tags": {"env": env, "owner": team, "costCenter": cc},
            "estimated_monthly_usd": standards.SKU_COST.get(sku, 2.10),
            "citations": ["std-naming#summary", f"std-sku-tiers#{tier}",
                          "std-tags#summary", f"std-regions#{env}"],
            "purpose": r.get("purpose", ""),
        })
    return resources, cc, region, env, team
