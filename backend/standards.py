"""Organisation standards corpus + the (storage-focused) module catalogue.

This is the ground truth the planner must compose from. For the practical v1
the deployable building block is an Azure Storage Account (instant, ~free,
exercises naming / region / SKU / tag governance). The richer VM / database
catalogue from the design document lives in the static showcase; it can be
layered in later behind the same flow.

`retrieval_chunks()` flattens this into small text chunks that the RAG layer
embeds (live) or keyword-scores (offline) and returns as grounded citations.
"""

LANDING_ZONE = {
    "name": "lz-sandbox-01",
    "resource_group": "rg-selfservice-lz",
    "region": "westus2",
    "policy_initiative": "Self-Service Guardrails (sandbox)",
}

# --- Standards documents ---
STANDARDS = [
    {
        "id": "std-naming", "title": "Naming Convention", "file": "naming_convention.md",
        "icon": "tag", "updated": "2026-05-02",
        "summary": "Storage accounts: {env}{team}st{nn} plus a short unique suffix; lowercase alphanumeric only, 3-24 chars (no hyphens — Azure storage names are global and restricted).",
        "body": [
            ["Pattern", "{env}{team}st{nn}{suffix}"],
            ["Example (dev)", "devretailst01a7f3"],
            ["Rules", "lowercase a-z0-9 only · 3-24 chars · globally unique · suffix avoids collisions"],
            ["Resource group tags", "named to convention and tagged; resources inherit owner + costCenter"],
        ],
    },
    {
        "id": "std-sku-tiers", "title": "Storage SKU Tiers", "file": "sku_tiers.md",
        "icon": "layers", "updated": "2026-04-28",
        "summary": "Bronze / Silver / Gold tiers map to allowed storage redundancy SKUs per environment. Dev is limited to Bronze (Standard_LRS).",
        "body": [
            ["Bronze (dev)", "Standard_LRS — locally redundant, lowest cost"],
            ["Silver (test/prod)", "Standard_ZRS / Standard_GRS — zone or geo redundant"],
            ["Gold (prod-critical)", "Standard_RAGRS — read-access geo redundant"],
            ["Constraint", "dev requests are limited to Standard_LRS unless escalated"],
        ],
    },
    {
        "id": "std-regions", "title": "Allowed Regions", "file": "allowed_regions.md",
        "icon": "globe", "updated": "2026-05-10",
        "summary": "Approved Azure regions per environment. Singapore (southeastasia) is prod-only.",
        "body": [
            ["dev", "westus2, eastus"],
            ["test", "westus2, eastus"],
            ["prod", "westus2, eastus, southeastasia"],
            ["Note", "southeastasia is approved for prod workloads only"],
        ],
    },
    {
        "id": "std-tags", "title": "Required Tags", "file": "required_tags.md",
        "icon": "bookmark", "updated": "2026-03-19",
        "summary": "env, owner and costCenter are mandatory on every deployed resource. Enforced (optionally) by an Azure Policy require-tag rule.",
        "body": [
            ["env", "dev | test | prod"],
            ["owner", "owning team alias (e.g. retail-analytics)"],
            ["costCenter", "valid CC-#### code from the Finance register"],
            ["Enforcement", "missing tags are rejected when the require-tag policy is assigned"],
        ],
    },
    {
        "id": "std-cost", "title": "Cost Guidance", "file": "cost_tiers.md",
        "icon": "dollar", "updated": "2026-05-01",
        "summary": "Approximate monthly cost per SKU, used for plan cost estimates. An empty Standard_LRS account is effectively free.",
        "body": [
            ["Standard_LRS", "~$0.02 / GB-month · empty ≈ $0"],
            ["Standard_GRS", "~$0.04 / GB-month"],
            ["Transactions", "fractions of a cent per 10k operations"],
        ],
    },
    {
        "id": "std-overrides", "title": "Team Overrides", "file": "team_overrides.md",
        "icon": "users", "updated": "2026-04-22",
        "summary": "Per-team defaults. retail-analytics defaults to westus2 / CC-1234; onboarding to eastus / CC-2207.",
        "body": [
            ["retail-analytics", "default region westus2 · costCenter CC-1234 · Bronze dev"],
            ["onboarding", "default region eastus · costCenter CC-2207"],
            ["ml-research", "default region westus2 · costCenter CC-3390"],
        ],
    },
]

# --- Module catalogue (what the planner may compose from) ---
CATALOG = [
    {
        "id": "catalog#storage", "kind": "storage_account", "icon": "box", "color": "amber",
        "title": "Storage Account",
        "module": "Microsoft.Storage/storageAccounts", "version": "2023-01-01",
        "purpose": "Standard general-purpose v2 storage account with HTTPS-only, TLS 1.2, and public blob access disabled by default.",
        "required": ["name", "location", "skuName", "kind"],
        "example": {"name": "devretailst01a7f3", "location": "westus2", "skuName": "Standard_LRS", "kind": "StorageV2"},
    },
]

# --- Per-team defaults used by the deterministic (offline) planner ---
TEAM_DEFAULTS = {
    "retail-analytics": {"region": "westus2", "cost_center": "CC-1234"},
    "retail": {"region": "westus2", "cost_center": "CC-1234"},
    "onboarding": {"region": "eastus", "cost_center": "CC-2207"},
    "ml-research": {"region": "westus2", "cost_center": "CC-3390"},
}

ALLOWED_REGIONS = {"dev": ["westus2", "eastus"], "test": ["westus2", "eastus"],
                   "prod": ["westus2", "eastus", "southeastasia"]}
SKU_BY_ENV = {"dev": "Standard_LRS", "test": "Standard_GRS", "prod": "Standard_GRS"}
SKU_COST = {"Standard_LRS": 2.10, "Standard_GRS": 4.20, "Standard_ZRS": 3.10, "Standard_RAGRS": 5.40}

SAMPLE_PROMPTS = [
    {"q": "I need a storage account for the retail-analytics team, dev environment.",
     "meta": "Happy path · one Standard_LRS account in westus2", "kind": "ok", "icon": "check-circle"},
    {"q": "Provision two storage accounts for the onboarding portal ingestion, dev.",
     "meta": "Two accounts · grounded plan + cost estimate", "kind": "info", "icon": "box"},
    {"q": "Set up blob storage for ml-research data staging in dev.",
     "meta": "Defaults applied from team overrides", "kind": "info", "icon": "database"},
]


def retrieval_chunks():
    """Flatten the standards corpus into small retrievable chunks."""
    chunks = []
    for s in STANDARDS:
        # one chunk for the summary
        chunks.append({"id": s["id"] + "#summary", "title": s["title"],
                       "text": s["summary"]})
        # one chunk per body row, so retrieval can cite specifics
        for k, v in s["body"]:
            chunks.append({"id": s["id"] + "#" + k.lower().split()[0].replace("/", ""),
                           "title": s["title"] + " — " + k, "text": f"{k}: {v}"})
    for c in CATALOG:
        chunks.append({"id": c["id"], "title": "Catalog — " + c["title"],
                       "text": f"{c['module']} ({c['version']}) — {c['purpose']}"})
    return chunks
