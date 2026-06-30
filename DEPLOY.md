# Deploying the Self-Service Provisioning demo on a Linux VM

This guide gets the demo running on an Azure Linux VM so others can use it via a
URL. It covers both modes:

- **Semi-simulation** (recommended to start): real AI planning + RAG, simulated
  provisioning. **No privileged Azure identity needed** — only the Azure OpenAI
  settings. Anyone can run it.
- **Real provisioning**: actually creates (and auto-deletes) Azure Storage
  accounts in a sandbox resource group, using the **VM's managed identity**.

---

## 1. Get the code and Python onto the VM

Recommended — clone the repo (the app sits at the repo root):

```bash
sudo apt-get update && sudo apt-get install -y python3 python3-pip git   # Ubuntu/Debian
git clone https://github.com/jy-fuji/self_service.git
cd self_service
pip3 install -r requirements.txt
```
Python 3.9+ is required. Update later with `git pull`. (Alternatively, copy
`service.zip` via Azure Blob + SAS and `wget`/`unzip` it.)

> If you keep the systemd units, point `WorkingDirectory` at the cloned folder
> (e.g. `/home/azureuser/self_service`).

## 2. Configure `.env`

```bash
cp .env.example .env
nano .env
```

**Semi-simulation** (start here) — fill only the Azure OpenAI block and keep:
```
SIMULATE_DEPLOY=true
AZURE_OPENAI_ENDPOINT=https://jiyan-m85rcjnj-eastus2.cognitiveservices.azure.com
AZURE_OPENAI_API_KEY=<your key>
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_EMBED_DEPLOYMENT=text-embedding-ada-002
AZURE_OPENAI_API_STYLE=responses
RESOURCE_TTL_MINUTES=120
```

**Real provisioning** — additionally set `SIMULATE_DEPLOY=false`, keep
`AZURE_SUBSCRIPTION_ID` / `AZURE_RESOURCE_GROUP`, and leave the service-principal
fields **blank** (the VM's managed identity is used). Then do step 3.

## 3. (Real mode only) Identity + guardrails — one-time

Run these where you have rights to assign roles (Azure Cloud Shell is easiest).
`<VM_RG>`/`<VM_NAME>` are your VM's; the sandbox RG is `rg-selfservice-lz`.

```bash
# a) give the VM a system-assigned managed identity (no app-registration rights needed)
az vm identity assign -g <VM_RG> -n <VM_NAME>
PRINCIPAL=$(az vm identity show -g <VM_RG> -n <VM_NAME> --query principalId -o tsv)

# b) let it deploy + delete ONLY in the sandbox RG
RGID=$(az group show -n rg-selfservice-lz --query id -o tsv)
az role assignment create --assignee-object-id "$PRINCIPAL" \
  --assignee-principal-type ServicePrincipal --role Contributor --scope "$RGID"

# c) (optional, free) real guardrails — block out-of-policy requests
az policy assignment create --name ssp-allowed-locations --scope "$RGID" \
  --policy e56962a6-4747-49cd-b67b-bf8b01975c4c \
  --params '{"listOfAllowedLocations":{"value":["westus2","eastus"]}}'
az policy assignment create --name ssp-require-env --scope "$RGID" \
  --policy 871b6d14-10aa-478d-b590-94f262ecfa99 --params '{"tagName":{"value":"env"}}'
```
> Step (b) needs **Owner** or **User Access Administrator** on the RG. Since you
> created the RG you may already have it; otherwise send these two lines to whoever
> owns the subscription. Nothing here needs Entra app-registration rights.

The app authenticates automatically via the VM managed identity
(`DefaultAzureCredential`) — no secrets in `.env`.

## 4. Run it

Quick (foreground):
```bash
HOST=0.0.0.0 PORT=8137 python3 run.py
```

As a service (survives reboot/logout) — edit the three marked lines for your paths/user:
```bash
sudo cp deploy/selfservice.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now selfservice
sudo systemctl status selfservice          # check it's running
journalctl -u selfservice -f               # logs
```

## 5. Open the port

Allow inbound **8137** in the VM's **Network Security Group**, then browse to
`http://<vm-public-ip>:8137`.

> The UI has no authentication of its own. Expose it only on a trusted network,
> or front it with a reverse proxy (nginx) + Entra SSO, or keep it on a private IP
> and reach it via SSH tunnel: `ssh -L 8137:localhost:8137 user@vm`.

## 6. Auto-delete (TTL)

Resources auto-delete after `RESOURCE_TTL_MINUTES` (default 120). The app runs an
**in-process janitor** every couple of minutes, so nothing extra is required.

For an app-independent safety net, also install the timer (optional):
```bash
sudo cp deploy/selfservice-janitor.service deploy/selfservice-janitor.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now selfservice-janitor.timer
sudo systemctl list-timers selfservice-janitor.timer
```

## 7. Verify

```bash
curl -s http://localhost:8137/api/config        # shows "mode": "azure-live" (real) or "llm-live" (semi-sim)
curl -s -X POST http://localhost:8137/api/janitor/run   # manual TTL sweep
```
Then in the browser: submit a request, switch to **Admin**, **Approve**, and watch
it provision and later auto-delete. The **Assistant** button (bottom-right) answers
"how do I…" questions.

## Notes & troubleshooting

- **Mode** is shown in the top bar and at `/api/config`. `azure-live` = real
  deploys; `llm-live` = semi-simulation.
- **Rotate** the Azure OpenAI key periodically; it lives only in `.env` (gitignored).
- **Corporate TLS proxy**: the app trusts the OS cert store automatically
  (`truststore`); usually nothing to do on an Azure VM.
- **`gpt-5.4-pro` is slow** (~2 min/plan); `gpt-5.4-mini` is the snappy default.
  Set `AZURE_OPENAI_API_STYLE=chat` only if you switch to a non-reasoning model
  like `gpt-4o-mini`.
- **Scope safety**: the managed identity is Contributor on the **one** sandbox RG
  only, and the janitor only ever deletes inside that RG and only resources tagged
  `managedBy=self-service-demo`.
