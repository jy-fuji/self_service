"""CMDB / landing-zone inventory.

Live  : Azure Resource Graph (free) KQL query over the sandbox resource group.
Offline: aggregates the deployed resources recorded in the store.
"""
from .config import cfg
from . import store


def list_resources():
    if cfg.azure_live:
        try:
            return _from_graph()
        except Exception:
            return _from_store()
    return _from_store()


def _from_graph():
    from azure.mgmt.resourcegraph import models as gm
    from .clients import graph_client
    graph = graph_client()
    query = (f"Resources | where resourceGroup =~ '{cfg.RESOURCE_GROUP}' "
             f"| project name, type, location, tags, resourceGroup, id "
             f"| order by name asc")
    req = gm.QueryRequest(subscriptions=[cfg.SUBSCRIPTION_ID], query=query,
                          options=gm.QueryRequestOptions(result_format="objectArray"))
    resp = graph.resources(req)
    rows = resp.data or []
    out = []
    for row in rows:
        out.append({
            "name": row.get("name"),
            "type": row.get("type"),
            "location": row.get("location"),
            "tags": row.get("tags") or {},
            "resource_group": row.get("resourceGroup"),
            "id": row.get("id"),
            "source": "resource-graph",
        })
    return out


def _from_store():
    out = []
    for item in store.deployed_resources():
        r = item["res"]
        name = r.get("naming")
        out.append({
            "name": name,
            "type": r.get("module", "Microsoft.Storage/storageAccounts"),
            "location": (r.get("params") or {}).get("location"),
            "tags": r.get("tags") or {},
            "resource_group": cfg.RESOURCE_GROUP or "rg-selfservice-lz",
            "id": (r.get("azure_ids") or [None])[0] or name,
            "endpoint": (f"https://{name}.blob.core.windows.net/"
                         if r.get("kind") == "storage_account" else None),
            "request_id": item["req"]["id"],
            "expires_at": item["req"].get("expires_at"),
            "estimated_monthly_usd": r.get("estimated_monthly_usd"),
            "source": "store",
        })
    return out
