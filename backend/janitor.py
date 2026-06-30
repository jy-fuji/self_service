"""Auto-delete expired resources (TTL).

Two passes:
  1. store pass   - every deployed request past its expiry is torn down via the
                    same deployer.destroy() used for manual delete (simulates in
                    semi-sim, really deletes in azure-live).
  2. orphan pass  - (azure-live only, best effort) any resource in the sandbox RG
                    tagged managedBy=self-service-demo with expiresAt in the past
                    that is NOT an active deployed request gets deleted. Catches
                    resources left behind if the store was lost.

Safe by construction: only ever touches the configured resource group, only
deletes things tagged as ours, and is idempotent.
"""
import time
import datetime
import threading

from .config import cfg
from . import store, deployer

MANAGED_BY = "self-service-demo"


def _now():
    return datetime.datetime.now()


def _parse(iso):
    try:
        return datetime.datetime.fromisoformat(iso)
    except Exception:
        return None


def _expired(iso):
    dt = _parse(iso)
    return bool(dt and dt <= _now())


def sweep_once(log=None):
    """Run one cleanup pass. Returns a summary dict."""
    log = log or (lambda *a: None)
    deleted_requests = []

    # --- pass 1: store-driven ---
    for r in store.all_requests():
        if r.get("status") == "deployed" and _expired(r.get("expires_at")):
            rid = r["id"]
            logs = []
            deployer.destroy(r.get("azure_ids", []), lambda lv, m: logs.append([lv, m]))
            stamp = _now().replace(microsecond=0).isoformat()
            store.patch(rid, lambda x: x.update(status="expired", deleted_at=stamp,
                                                destroy_log=logs))
            deleted_requests.append(rid)
            log("info", f"TTL expired -> deleted {rid}")

    # --- pass 2: orphan safety net (real Azure only) ---
    orphans = []
    if cfg.azure_live:
        try:
            orphans = _sweep_orphans(log)
        except Exception as e:  # noqa: BLE001
            log("warn", "orphan sweep error: " + str(e)[:160])

    return {"deleted_requests": deleted_requests, "deleted_orphans": orphans,
            "at": _now().replace(microsecond=0).isoformat()}


def _active_resource_ids():
    ids = set()
    for r in store.all_requests():
        if r.get("status") == "deployed" and not _expired(r.get("expires_at")):
            for rid in r.get("azure_ids", []):
                ids.add(rid)
    return ids


def _sweep_orphans(log):
    from azure.mgmt.resourcegraph import models as gm
    from .clients import graph_client, resource_client
    graph = graph_client()
    q = (f"Resources | where resourceGroup =~ '{cfg.RESOURCE_GROUP}' "
         f"| where tags['managedBy'] =~ '{MANAGED_BY}' "
         f"| project id, expiresAt = tostring(tags['expiresAt'])")
    req = gm.QueryRequest(subscriptions=[cfg.SUBSCRIPTION_ID], query=q,
                          options=gm.QueryRequestOptions(result_format="objectArray"))
    rows = graph.resources(req).data or []
    active = _active_resource_ids()
    rc = resource_client()
    deleted = []
    for row in rows:
        rid = row.get("id")
        if rid and rid not in active and _expired(row.get("expiresAt")):
            try:
                rc.resources.begin_delete_by_id(rid, "2023-01-01").result()
                deleted.append(rid)
                log("info", f"orphan deleted {rid.split('/')[-1]}")
            except Exception as e:  # noqa: BLE001
                log("warn", f"orphan delete failed {rid.split('/')[-1]}: {str(e)[:120]}")
    return deleted


_started = False


def start_scheduler():
    """Start the background sweep loop (idempotent)."""
    global _started
    if _started or not cfg.JANITOR_ENABLED:
        return
    _started = True

    def loop():
        while True:
            time.sleep(max(15, cfg.JANITOR_INTERVAL_SECONDS))
            try:
                sweep_once()
            except Exception:
                pass

    threading.Thread(target=loop, daemon=True, name="ttl-janitor").start()
