"""Runtime configuration. Reads from environment / .env.

The service runs in three progressive modes, decided purely by which
environment variables are present:

  * offline   - no Azure at all. Planning uses a deterministic local
                classifier, retrieval uses keyword scoring, deployment is
                simulated. Great for development and demos with no cloud.
  * llm-live  - Azure OpenAI configured -> real grounded planning + real
                embeddings for RAG, but deployment still simulated.
  * azure-live- Subscription + resource group + credentials configured ->
                real ARM validation, real deployment of a storage account,
                and a real Azure Resource Graph CMDB view.

You can enable them independently: configure only Azure OpenAI to get real
planning while still simulating deploys, then add the deploy target later.
"""
import os

try:
    from dotenv import load_dotenv
    # Load .env from the service/ directory (parent of backend/) and CWD.
    here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(os.path.dirname(here), ".env"))
    load_dotenv()
except Exception:
    pass


# Trust the OS certificate store so requests work behind a corporate
# TLS-inspection proxy. Done lazily (only before a real network call) because
# the native cert-store hook can't run inside a restricted sandbox.
_truststore_done = False


def ensure_truststore():
    global _truststore_done
    if _truststore_done:
        return
    _truststore_done = True
    try:
        import truststore
        truststore.inject_into_ssl()
    except Exception:
        pass


def _g(name, default=""):
    return (os.getenv(name, default) or "").strip()


class Config:
    # --- Azure OpenAI (the AI brain) ---
    AOAI_ENDPOINT = _g("AZURE_OPENAI_ENDPOINT")
    AOAI_KEY = _g("AZURE_OPENAI_API_KEY")
    AOAI_API_VERSION = _g("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")
    AOAI_EMBED_API_VERSION = _g("AZURE_OPENAI_EMBED_API_VERSION", "2024-10-21")
    AOAI_CHAT_DEPLOYMENT = _g("AZURE_OPENAI_CHAT_DEPLOYMENT", "gpt-4o-mini")
    AOAI_EMBED_DEPLOYMENT = _g("AZURE_OPENAI_EMBED_DEPLOYMENT", "text-embedding-3-small")
    # API surface for the chat model: 'auto' tries the Responses API (needed by
    # reasoning models like gpt-5.x-pro) and falls back to Chat Completions.
    AOAI_API_STYLE = _g("AZURE_OPENAI_API_STYLE", "auto").lower()
    AOAI_REASONING_EFFORT = _g("AZURE_OPENAI_REASONING_EFFORT", "")  # "", medium, high
    try:
        AOAI_MAX_OUTPUT_TOKENS = int(_g("AZURE_OPENAI_MAX_OUTPUT_TOKENS", "4096") or "4096")
    except ValueError:
        AOAI_MAX_OUTPUT_TOKENS = 4096

    # --- Azure deployment target (the landing zone) ---
    SUBSCRIPTION_ID = _g("AZURE_SUBSCRIPTION_ID")
    RESOURCE_GROUP = _g("AZURE_RESOURCE_GROUP")
    LOCATION = _g("AZURE_LOCATION", "westus2")

    # --- Service principal (optional; else DefaultAzureCredential) ---
    TENANT_ID = _g("AZURE_TENANT_ID")
    CLIENT_ID = _g("AZURE_CLIENT_ID")
    CLIENT_SECRET = _g("AZURE_CLIENT_SECRET")

    # When no service principal is set, how to sign the user in:
    # 'auto' = try CLI/PowerShell session, else pop a browser; 'device' = device code.
    AUTH_FLOW = _g("AZURE_AUTH_FLOW", "auto").lower()

    # Semi-simulation: do real RAG + LLM planning, but simulate the deploy and
    # CMDB (realistic resource IDs) so no privileged Azure identity is needed.
    SIMULATE_DEPLOY = _g("SIMULATE_DEPLOY", "false").lower() in ("1", "true", "yes", "on")

    # Time-to-live: provisioned resources are auto-deleted after this many minutes.
    RESOURCE_TTL_MINUTES = int(_g("RESOURCE_TTL_MINUTES", "120") or "120")
    MAX_TTL_MINUTES = int(_g("MAX_TTL_MINUTES", "1440") or "1440")          # cap for "extend"
    JANITOR_INTERVAL_SECONDS = int(_g("JANITOR_INTERVAL_SECONDS", "120") or "120")
    JANITOR_ENABLED = _g("JANITOR_ENABLED", "true").lower() in ("1", "true", "yes", "on")

    # --- Display ---
    LZ_NAME = _g("LANDING_ZONE_NAME", "lz-sandbox-01")

    @property
    def llm_live(self) -> bool:
        return bool(self.AOAI_ENDPOINT and self.AOAI_KEY)

    @property
    def azure_live(self) -> bool:
        # Real deploys require a target AND not being in simulate-deploy mode.
        return bool(self.SUBSCRIPTION_ID and self.RESOURCE_GROUP) and not self.SIMULATE_DEPLOY

    @property
    def has_sp(self) -> bool:
        return bool(self.TENANT_ID and self.CLIENT_ID and self.CLIENT_SECRET)

    @property
    def mode(self) -> str:
        if self.azure_live and self.llm_live:
            return "azure-live"
        if self.llm_live:
            return "llm-live"
        return "offline"

    def summary(self) -> dict:
        return {
            "mode": self.mode,
            "llm_live": self.llm_live,
            "azure_live": self.azure_live,
            "simulate_deploy": self.SIMULATE_DEPLOY,
            "chat_deployment": self.AOAI_CHAT_DEPLOYMENT if self.llm_live else None,
            "embed_deployment": self.AOAI_EMBED_DEPLOYMENT if self.llm_live else None,
            "subscription": (self.SUBSCRIPTION_ID[:8] + "…") if self.SUBSCRIPTION_ID else None,
            "resource_group": self.RESOURCE_GROUP or None,
            "location": self.LOCATION,
            "landing_zone": self.LZ_NAME,
            "resource_ttl_minutes": self.RESOURCE_TTL_MINUTES,
            "auth": "service-principal" if self.has_sp else (
                (("device-code" if self.AUTH_FLOW == "device" else "user login (CLI / browser)") if self.azure_live else None)),
        }


cfg = Config()
