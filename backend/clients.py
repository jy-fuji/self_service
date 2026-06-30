"""Lazily-constructed, cached Azure SDK clients.

Imports are deferred so that offline mode never requires the Azure packages
to be importable at module load.
"""
from .config import cfg

_cred = None
_rc = None
_graph = None


def credential():
    global _cred
    if _cred is None:
        from .config import ensure_truststore
        ensure_truststore()
        if cfg.has_sp:
            from azure.identity import ClientSecretCredential
            _cred = ClientSecretCredential(cfg.TENANT_ID, cfg.CLIENT_ID, cfg.CLIENT_SECRET)
        else:
            # No service principal. On an Azure VM this uses the VM's managed
            # identity (no secrets); otherwise it falls back to an existing az /
            # PowerShell session, then an interactive sign-in.
            from azure.identity import (ManagedIdentityCredential, AzureCliCredential,
                                        AzurePowerShellCredential, InteractiveBrowserCredential,
                                        DeviceCodeCredential, ChainedTokenCredential)
            kw = {"tenant_id": cfg.TENANT_ID} if cfg.TENANT_ID else {}
            chain = [ManagedIdentityCredential(), AzureCliCredential(), AzurePowerShellCredential()]
            chain.append(DeviceCodeCredential(**kw) if cfg.AUTH_FLOW == "device"
                         else InteractiveBrowserCredential(**kw))
            _cred = ChainedTokenCredential(*chain)
    return _cred


def resource_client():
    global _rc
    if _rc is None:
        from azure.mgmt.resource.resources import ResourceManagementClient
        _rc = ResourceManagementClient(credential(), cfg.SUBSCRIPTION_ID)
    return _rc


def graph_client():
    global _graph
    if _graph is None:
        from azure.mgmt.resourcegraph import ResourceGraphClient
        _graph = ResourceGraphClient(credential())
    return _graph
