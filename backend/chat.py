"""End-user help assistant.

A grounded, domain-scoped helper that answers "how do I use this?" questions
(how to create a request, what's allowed, governance, auto-delete, roles…).

Live: gpt-5.4-mini via the Responses API, grounded in a help summary + retrieved
standards. Offline: a small keyword FAQ so the assistant still works with no LLM.
It explains; it does not take actions.
"""
from .config import cfg
from . import rag, standards


def _help_text():
    ttl = cfg.RESOURCE_TTL_MINUTES
    regions = ", ".join(standards.ALLOWED_REGIONS["dev"])
    return f"""ABOUT THIS SYSTEM
Self-Service Provisioning is an AI-governed way to get cloud resources from a
plain-English request — no tickets. Flow: you describe what you need -> the agent
retrieves your organisation's standards (RAG) and composes a grounded plan ->
it is validated -> an admin approves -> it is provisioned -> it shows in the CMDB.

HOW TO CREATE A REQUEST
Open "New Request" in the left nav, type what you need in plain English
(for example: "a storage account for the retail-analytics team, dev"), and click
Submit. Watch the steps run, then it waits for approval.

WHAT YOU CAN PROVISION (v1)
- Resource type: Azure Storage accounts.
- Environment: dev. Regions: {regions}. SKU: Standard_LRS (Bronze tier).
Anything outside these is blocked by governance — ask and I'll explain the options.

GOVERNANCE (three gates)
Azure Policy (allowed regions/SKUs, required tags), RBAC/scope (deploys go only to
the sandbox resource group), and human approval. The AI proposes; it never deploys
on its own.

APPROVAL
A Platform Admin approves or rejects. In this demo you can switch to the "Admin"
view (bottom-left) to approve your own request.

AUTO-DELETE (TTL)
Provisioned resources are automatically deleted after about {ttl} minutes to keep
the sandbox clean and costs near zero. On a deployed request you can "Extend" the
time or "Delete now".

ROLES
Requester (submits requests) and Admin (approves). Tags env/owner/costCenter are
applied automatically. See provisioned resources on the "Landing Zone" page."""


SYSTEM = """You are the friendly help assistant for the "Self-Service Provisioning"
demo. Answer ONLY questions about using this system, grounded in the context
provided. Be concise and practical (a few sentences or short bullets). If asked
for something outside the system's scope or not in the context, say so briefly and
point them to what they can do. Never claim to have created, approved, or deleted
anything — you only explain; the user acts in the UI."""

# --- offline keyword FAQ (best-score match; sharper, multi-word keys) ---
_FAQ = [
    (("create a request", "make a request", "submit", "new request", "how do i create", "how to create", "raise a request"),
     "Go to \"New Request\" in the left nav, type what you need in plain English "
     "(e.g. \"a storage account for the retail-analytics team, dev\") and click Submit. "
     "The agent retrieves standards, builds a grounded plan, validates it, then it waits for admin approval."),
    (("what can i", "what resources", "allowed type", "resource type", "what can be", "provision what", "supported"),
     "In v1 you can provision Azure Storage accounts in the dev environment, regions westus2/eastus, "
     "SKU Standard_LRS. Other types, regions or SKUs are blocked by governance."),
    (("region", "location", "westus", "eastus", "singapore"),
     "Allowed dev regions are westus2 and eastus. Other regions (e.g. Singapore) are governed and would be refused."),
    (("sku", "size", "tier", "redundan"),
     "Dev is limited to the Bronze tier (Standard_LRS for storage). Larger/redundant SKUs need a higher tier/environment."),
    (("approve", "approval", "reject", "sign off"),
     "A Platform Admin approves or rejects. In the demo, switch to the \"Admin\" view (bottom-left) to approve."),
    (("how long", "ttl", "expire", "auto-delete", "auto delete", "lifetime", "deleted", "last", "clean up", "teardown"),
     "Provisioned resources auto-delete after the TTL (about {ttl} minutes). On a deployed request you can "
     "\"Extend\" the time or \"Delete now\"."),
    (("governance", "policy", "rbac", "gate", "compliance", "secure", "guardrail"),
     "Three gates govern every request: Azure Policy (regions/SKUs/tags), RBAC/scope (one sandbox resource group), "
     "and human approval. The AI never deploys directly."),
    (("role", "admin", "requester", "who can", "permission"),
     "Two roles: Requester (submits) and Admin (approves). Toggle them bottom-left in the demo."),
    (("tag", "cost", "owner", "budget", "costcenter"),
     "Every resource is auto-tagged with env, owner and costCenter, and a short-lived cost estimate is shown in the plan."),
]


def _offline_answer(message):
    t = (message or "").lower()
    ttl = cfg.RESOURCE_TTL_MINUTES
    best, best_score = None, 0
    for keys, ans in _FAQ:
        score = sum(1 for k in keys if k in t)
        if score > best_score:
            best, best_score = ans, score
    if best:
        return best.format(ttl=ttl)
    return ("I can help you use the Self-Service Provisioning demo — try asking how to create a "
            "request, what you can provision, the allowed regions/SKUs, how approval works, or how "
            "long resources last before auto-delete.")


def _live_answer(message, history):
    from . import planner  # reuse the same Azure OpenAI client + truststore
    client = planner._chat_client()
    grounding = rag.retrieve(message, top_k=4)
    ground_text = "\n".join(f"- {c['text']}" for c in grounding)
    instructions = SYSTEM + "\n\nCONTEXT\n" + _help_text() + "\n\nRELEVANT STANDARDS\n" + ground_text

    items = []
    for h in (history or [])[-8:]:
        role = h.get("role")
        content = (h.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            items.append({"role": role, "content": content})
    items.append({"role": "user", "content": message})

    style = getattr(planner, "_RESOLVED", {}).get("style") or cfg.AOAI_API_STYLE
    if style in ("auto", "responses"):
        try:
            r = client.responses.create(model=cfg.AOAI_CHAT_DEPLOYMENT, instructions=instructions,
                                        input=items, max_output_tokens=1200)
            return r.output_text.strip()
        except Exception:
            if style == "responses":
                raise
    # chat-completions fallback
    msgs = [{"role": "system", "content": instructions}] + items
    r = client.chat.completions.create(model=cfg.AOAI_CHAT_DEPLOYMENT, messages=msgs,
                                       max_completion_tokens=1200)
    return (r.choices[0].message.content or "").strip()


def answer(message, history):
    if not message:
        return _offline_answer("")
    if cfg.llm_live:
        try:
            return _live_answer(message, history)
        except Exception:
            return _offline_answer(message)
    return _offline_answer(message)
