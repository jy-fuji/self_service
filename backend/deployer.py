"""Validation + deployment of the generated ARM template.

Live  : real ARM validate (begin_validate) and real deploy
        (begin_create_or_update) into the sandbox resource group, then capture
        the created resource IDs. Deletion uses generic delete-by-id.
Offline: simulates the same steps with realistic log lines and fake IDs.
"""
import time
import uuid

from .config import cfg
from . import generator


def _fake_id(name):
    # Use the real subscription/RG (when configured) so simulated IDs look authentic.
    sub = cfg.SUBSCRIPTION_ID or "00000000-0000-0000-0000-000000000000"
    rg = cfg.RESOURCE_GROUP or "rg-selfservice-lz"
    return (f"/subscriptions/{sub}/resourceGroups/{rg}/providers/"
            f"Microsoft.Storage/storageAccounts/{name}")


def validate(resources, log):
    """Return (ok, errors[]). Live runs a real ARM validation."""
    log("info", "Validating ARM template (what-if style preflight)…")
    if not cfg.azure_live:
        time.sleep(0.4)
        log("ok", "Template valid · 0 errors")
        return True, []
    try:
        from .clients import resource_client
        rc = resource_client()
        arm = generator.build_arm(resources)
        deployment = {"properties": {"template": arm, "mode": "Incremental"}}
        poller = rc.deployments.begin_validate(cfg.RESOURCE_GROUP, "ssp-validate", deployment)
        poller.result()
        log("ok", "Template valid · accepted by Azure Resource Manager")
        return True, []
    except Exception as e:  # noqa: BLE001
        msg = _err_message(e)
        log("warn", "Validation reported: " + msg)
        return False, [msg]


def deploy(req_id, resources, log):
    """Deploy the resources. Returns dict {ok, resource_ids, error}."""
    arm = generator.build_arm(resources)
    dep_name = "ssp-" + req_id.replace("req-", "").replace("-", "")[:24]

    if not cfg.azure_live:
        rg = cfg.RESOURCE_GROUP or "rg-selfservice-lz"
        sub = cfg.SUBSCRIPTION_ID or "00000000-0000-0000-0000-000000000000"
        log("run", f"Pipeline 'deploy' started · {len(resources)} resource(s)")
        log("info", f"Authenticating to subscription {sub[:8]}… via federated identity")
        log("run", f"az deployment group create -g {rg} --name {dep_name}")
        time.sleep(0.5)
        ids = []
        for r in resources:
            log("info", f"Creating storage account {r['naming']} ({r['params']['skuName']}, {r['params']['location']})")
            time.sleep(0.5)
            ids.append(_fake_id(r["naming"]))
        log("ok", f"Deployment succeeded · {len(ids)} resource(s) live in {rg}")
        return {"ok": True, "resource_ids": ids, "error": None}

    try:
        from .clients import resource_client
        rc = resource_client()
        log("run", f"az deployment group create -g {cfg.RESOURCE_GROUP} (deployment {dep_name})")
        log("info", "Authenticating with the scoped service principal / managed identity")
        deployment = {"properties": {"template": arm, "mode": "Incremental"}}
        poller = rc.deployments.begin_create_or_update(cfg.RESOURCE_GROUP, dep_name, deployment)
        for r in resources:
            log("info", f"Creating storage account {r['naming']} ({r['params']['skuName']}, {r['params']['location']})")
        result = poller.result()
        ids = []
        out = getattr(result.properties, "output_resources", None) or []
        for o in out:
            rid = getattr(o, "id", None)
            if rid:
                ids.append(rid)
        if not ids:  # fallback: synthesise from names
            ids = [_real_id(r["naming"]) for r in resources]
        log("ok", f"Deployment succeeded · {len(ids)} resource(s) live in {cfg.RESOURCE_GROUP}")
        return {"ok": True, "resource_ids": ids, "error": None}
    except Exception as e:  # noqa: BLE001
        msg = _err_message(e)
        log("warn", "Deployment failed: " + msg)
        return {"ok": False, "resource_ids": [], "error": msg}


def destroy(resource_ids, log):
    """Delete the deployed resources (cleanup). Live uses delete-by-id."""
    if not cfg.azure_live:
        for rid in resource_ids:
            log("info", f"Deleting {rid.split('/')[-1]}")
            time.sleep(0.2)
        log("ok", "Sandbox resources deleted")
        return True
    try:
        from .clients import resource_client
        rc = resource_client()
        for rid in resource_ids:
            log("info", f"Deleting {rid.split('/')[-1]}")
            rc.resources.begin_delete_by_id(rid, "2023-01-01").result()
        log("ok", "Sandbox resources deleted")
        return True
    except Exception as e:  # noqa: BLE001
        log("warn", "Cleanup error: " + _err_message(e))
        return False


def _real_id(name):
    return (f"/subscriptions/{cfg.SUBSCRIPTION_ID}/resourceGroups/{cfg.RESOURCE_GROUP}"
            f"/providers/Microsoft.Storage/storageAccounts/{name}")


def _err_message(e):
    # Surface Azure policy / ARM error codes nicely if present.
    try:
        err = getattr(e, "error", None)
        if err is not None and getattr(err, "code", None):
            code = err.code
            msg = getattr(err, "message", "") or ""
            return f"{code}: {msg[:240]}"
    except Exception:
        pass
    return str(e)[:240]
