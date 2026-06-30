# ============================================================
# One-time Azure setup for the Self-Service Provisioning demo.
# Creates: Azure OpenAI (S0) + 2 model deployments, a sandbox
# resource group, and a service principal scoped Contributor on it.
# Prints the values to paste into service/.env.
#
# Prereqs: Azure CLI (`az`) and an account with rights to create
# a Cognitive Services resource and a resource group + role assignment.
# Run interactively and review each step. Adjust names/regions freely.
# ============================================================

$ErrorActionPreference = "Stop"

# ---- EDIT THESE ----
$Location      = "eastus2"                      # broad model availability
$AoaiRg        = "rg-selfservice-aoai"          # holds the OpenAI resource
$AoaiName      = "aoai-selfservice-$((Get-Random -Maximum 9999))"  # must be globally unique
$SandboxRg     = "rg-selfservice-lz"            # the landing zone we deploy INTO
$SpName        = "sp-selfservice-demo"
$ChatModel     = "gpt-4o-mini";        $ChatVersion  = "2024-07-18"
$EmbedModel    = "text-embedding-3-small"; $EmbedVersion = "1"
# --------------------

Write-Host "==> az login (a browser may open)..." -ForegroundColor Cyan
az login | Out-Null
$SubId = az account show --query id -o tsv
Write-Host "Subscription: $SubId"

Write-Host "==> Creating resource groups..." -ForegroundColor Cyan
az group create -n $AoaiRg   -l $Location | Out-Null
az group create -n $SandboxRg -l $Location | Out-Null

Write-Host "==> Creating Azure OpenAI (S0) resource '$AoaiName'..." -ForegroundColor Cyan
az cognitiveservices account create -g $AoaiRg -n $AoaiName `
  --kind AIServices --sku S0 -l $Location --custom-domain $AoaiName --yes | Out-Null

Write-Host "==> Deploying models (Global Standard)..." -ForegroundColor Cyan
az cognitiveservices account deployment create -g $AoaiRg -n $AoaiName `
  --deployment-name $ChatModel  --model-name $ChatModel  --model-version $ChatVersion  `
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 10 | Out-Null
az cognitiveservices account deployment create -g $AoaiRg -n $AoaiName `
  --deployment-name $EmbedModel --model-name $EmbedModel --model-version $EmbedVersion `
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 10 | Out-Null

$Endpoint = az cognitiveservices account show -g $AoaiRg -n $AoaiName --query properties.endpoint -o tsv
$Key      = az cognitiveservices account keys list -g $AoaiRg -n $AoaiName --query key1 -o tsv

Write-Host "==> Creating service principal scoped Contributor on '$SandboxRg'..." -ForegroundColor Cyan
$RgId = az group show -n $SandboxRg --query id -o tsv
$Sp   = az ad sp create-for-rbac --name $SpName --role Contributor --scopes $RgId | ConvertFrom-Json

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Paste the following into service\.env" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
@"
AZURE_OPENAI_ENDPOINT=$Endpoint
AZURE_OPENAI_API_KEY=$Key
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_CHAT_DEPLOYMENT=$ChatModel
AZURE_OPENAI_EMBED_DEPLOYMENT=$EmbedModel

AZURE_SUBSCRIPTION_ID=$SubId
AZURE_RESOURCE_GROUP=$SandboxRg
AZURE_LOCATION=$Location

AZURE_TENANT_ID=$($Sp.tenant)
AZURE_CLIENT_ID=$($Sp.appId)
AZURE_CLIENT_SECRET=$($Sp.password)
"@ | Write-Host

Write-Host "(The client secret is shown once — copy it now.)" -ForegroundColor Yellow

# Optional next iteration — enforce real policy denials on the sandbox RG:
#   az policy assignment create --name require-tag-env --scope $RgId `
#     --policy "871b6d14-10aa-478d-b590-94f262ecfa99" --params '{\"tagName\":{\"value\":\"env\"}}'
#   az policy assignment create --name allowed-locations --scope $RgId `
#     --policy "e56962a6-4747-49cd-b67b-bf8b01975c4c" --params '{\"listOfAllowedLocations\":{\"value\":[\"westus2\",\"eastus\"]}}'
