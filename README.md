# Self-Service Provisioning — working service (v1)

A real, end-to-end implementation of the AI-governed self-service provisioning
loop, in Python (FastAPI) behind the same polished web UI as the showcase demo:

> natural-language request → grounded plan (RAG + LLM) → validation → human
> approval → **real Azure deployment** → CMDB inventory → **auto-delete (TTL)**.

Also includes a **help chat assistant** (bottom-right "Assistant" button — or
deep-link `?chat=1`) that answers "how do I…" questions grounded in the standards,
and a **TTL janitor** that automatically deletes provisioned resources after a
configurable time (default 2 h; users can Extend or Delete now).

**Deploying on a Linux VM?** See **[DEPLOY.md](DEPLOY.md)** — including using the
VM's managed identity so real deploys need no secrets and anyone can use the URL.

To stay practical, v1 provisions the cheapest meaningful building block — a
**tagged Azure Storage Account** in a sandbox resource group (instant, ~free,
torn down with one click). The governed pipeline is identical to what VMs or
databases would use; only the catalogue entry differs.

## Three modes (auto-detected from `.env`)

| Mode | What's real | Needs |
|------|-------------|-------|
| **offline** | nothing — planning & deploy simulated | nothing (runs out of the box) |
| **llm-live** | real grounded planning + real RAG embeddings | Azure OpenAI only |
| **azure-live** | + real storage deploys + real Resource Graph CMDB | Azure OpenAI + subscription/RG + credentials |

You can enable them independently — configure only Azure OpenAI first, add the
deploy target later. The UI shows the active mode in the top bar.

### Semi-simulation (the shareable default)

Set **`SIMULATE_DEPLOY=true`** to run **real RAG + LLM planning** but **simulate
the deploy and CMDB** — with realistic resource IDs (your real subscription/RG),
blob endpoints, and a clean deployment log. No privileged Azure identity is
needed, so **anyone can run the demo** with just the Azure OpenAI key. This is
the recommended way to share it widely; flip it to `false` once a shared deploy
identity (managed identity / service principal) is in place.

> The chat model can be any deployment. A reasoning model such as `gpt-5.4-pro`
> grounds well but is slow (~2 min/plan); a `…-mini` deployment is far snappier.
> Set `AZURE_OPENAI_API_STYLE=responses` for gpt-5.x models, `chat` for gpt-4o-mini,
> or `auto` to try Responses then fall back. Behind a corporate TLS proxy the
> app uses the OS trust store automatically (`truststore`).

## Quick start (Windows, Linux, macOS)

```bash
cd service
pip install -r requirements.txt
python run.py                 # → http://127.0.0.1:8137
```
`python run.py` is the one command that works everywhere. Equivalents:
Windows PowerShell `.\run.ps1` · Linux/macOS `bash run.sh` · or directly
`python -m uvicorn backend.app:app --port 8137` (from the `service/` directory).

Open the app, go to **New Request**, submit *"I need a storage account for the
retail-analytics team, dev"*, watch it plan, switch to **Admin** (bottom-left),
**Approve** — and see the provisioning land in the CMDB.

### Run on a Linux server / VM (so others can reach it)

```bash
cd service
pip install -r requirements.txt
HOST=0.0.0.0 PORT=8137 python run.py        # bind to all interfaces
```
Then open the VM's port 8137 in its **Network Security Group** and browse to
`http://<vm-ip>:8137`. Note the UI has no authentication of its own, so expose it
only on a trusted network (or put it behind an SSH tunnel / reverse proxy + SSO).
In semi-simulation mode no Azure deploy credentials are needed — only the Azure
OpenAI settings in `.env`.

## Go live

1. Create the Azure resources (one-time):
   ```powershell
   ./setup_azure.ps1       # creates OpenAI + 2 models + sandbox RG + service principal
   ```
   It prints a ready-to-paste block of values.
2. `cp .env.example .env` (Windows: `copy`) and paste those values in; set
   `SIMULATE_DEPLOY=false`.
3. `python run.py` again. The top bar now reads **Live Azure**; approving a
   request provisions a real storage account and the CMDB reads from Azure
   Resource Graph.

### What you need in Azure (recap)

- **Azure OpenAI / Foundry** (S0) with two deployments: `gpt-4o-mini` and
  `text-embedding-3-small` (Global Standard, e.g. East US 2). ~cents per session.
- A **sandbox resource group** (the landing zone).
- A **service principal** with **Contributor scoped to that one RG** (or use
  `az login` / `DefaultAzureCredential` and skip the SP).

Everything else (Resource Graph CMDB, the storage accounts you deploy) is free
or pennies. No Azure AI Search needed — the ~6-doc corpus is embedded in memory.

## Architecture

```
service/
  backend/
    config.py      # mode detection from env
    standards.py   # the standards corpus + storage catalogue (RAG source of truth)
    rag.py         # embeddings + cosine (live) / keyword scoring (offline)
    planner.py     # Azure OpenAI Structured Outputs (live) / deterministic (offline)
    generator.py   # plan -> ARM JSON (deterministic, no Bicep CLI needed)
    deployer.py    # ARM validate + deploy + delete (azure-mgmt-resource)
    inventory.py   # Resource Graph CMDB (live) / store (offline)
    store.py       # request persistence (data/requests.json)
    app.py         # FastAPI: agent orchestration + API + serves the UI
  web/             # reused UI (index.html, assets/) — now API-driven
  setup_azure.ps1  # one-time Azure provisioning
  .env.example
```

API: `POST /api/requests` · `GET /api/requests[/{id}]` ·
`POST /api/requests/{id}/approve|reject|destroy` · `GET /api/resources` ·
`GET /api/standards` · `GET /api/config`.

## Teardown / cost hygiene

Each deployed request has a **Tear down** button (deletes its storage accounts).
Storage accounts are ~free when empty; the LLM is the only real cost and runs to
cents. Delete the two resource groups to remove everything.

## Next iterations (not in v1)

- Assign the Azure Policy initiative to the sandbox RG → a **real** policy-denial
  bad-path (the `setup_azure.ps1` footer has the commands).
- ARM what-if preview before deploy; richer catalogue (VNet/NSG/Key Vault).
- Teams Adaptive Card approval; OIDC GitHub Actions pipeline ("passwordless").
