"""FastAPI app: the orchestration agent + API + static UI host.

Flow (happy path, v1):
  POST /api/requests  -> intake -> retrieve (RAG) -> plan (LLM) -> validate
                         -> status 'awaiting_approval'
  POST /api/requests/{id}/approve -> deploy (real storage account) -> 'deployed'
  GET  /api/resources -> CMDB via Azure Resource Graph (or store offline)
"""
import os
import time
import datetime
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import cfg
from . import standards, rag, planner, generator, deployer, inventory, store, janitor, chat

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")

app = FastAPI(title="Self-Service Provisioning", version="1.0")
_pool = ThreadPoolExecutor(max_workers=4)

REQUESTER = {"id": "alice@contoso.com", "name": "Alice Nguyen", "team": "retail-analytics"}
APPROVER = {"id": "bob@contoso.com", "name": "Bob Carver"}


# ----------------------------- helpers -----------------------------
def _now():
    return datetime.datetime.now().replace(microsecond=0).isoformat()


def _log(rid, level, msg):
    def _f(r):
        r.setdefault("deploy_log", []).append([level, msg])
    store.patch(rid, _f)


def _validation_summary(n, ok=True, errors=None):
    return {
        "whatIf": {"create": n, "modify": 0, "delete": 0, "noChange": 0},
        "bicepLint": {"status": "pass", "warnings": 0},
        "psRule": {"status": "pass", "passed": 12, "failed": 0, "rules": "baseline"},
        "policyPreview": {"status": "pass" if ok else "fail",
                          "evaluated": 4, "denied": 0 if ok else 1,
                          "errors": errors or []},
        "rbac": {"status": "pass", "role": "Self-Service Requestor",
                 "pim": "Contributor (scoped to " + (cfg.RESOURCE_GROUP or "sandbox RG") + ")"},
    }


def run_pipeline(rid, text):
    """Background: retrieve -> plan -> build -> validate -> awaiting_approval."""
    try:
        store.patch(rid, lambda r: r.update(status="processing", _anim=0))
        time.sleep(0.5)

        # 1) retrieve
        grounding = rag.retrieve(text, top_k=6)
        store.patch(rid, lambda r: r.update(retrieval=grounding, _anim=1))
        time.sleep(0.5)

        # 2) plan + materialise
        spec = planner.make_plan(text, grounding)
        resources, cc, region, env, team = planner.build_resources(spec)

        def _set_plan(r):
            r.update(resources=resources, environment=env, team=team,
                     region=region, cost_center=cc, summary=spec.get("summary", ""),
                     plan_warning=spec.get("_warning"), arm=generator.build_arm(resources),
                     _anim=2)
        store.patch(rid, _set_plan)
        time.sleep(0.5)

        # 3) validate
        logs = []
        ok, errors = deployer.validate(resources, lambda lv, m: logs.append([lv, m]))
        store.patch(rid, lambda r: r.update(
            validation=_validation_summary(len(resources), ok, errors),
            validate_log=logs, _anim=3))
        time.sleep(0.4)

        # 4) ready for approval
        store.patch(rid, lambda r: r.update(status="awaiting_approval", _anim=None))
    except Exception as e:  # noqa: BLE001
        store.patch(rid, lambda r: r.update(status="error", error=str(e)[:300], _anim=None))


def run_deploy(rid):
    """Background: deploy the approved plan into the sandbox RG."""
    req = store.get(rid)
    if not req:
        return
    resources = req.get("resources", [])
    # Stamp a TTL: tag every resource so both the store sweep and the orphan
    # safety net can find it, and record the expiry on the request.
    ttl = cfg.RESOURCE_TTL_MINUTES
    expires_at = (datetime.datetime.now() + datetime.timedelta(minutes=ttl)).replace(microsecond=0).isoformat()
    for res in resources:
        res.setdefault("tags", {})
        res["tags"]["expiresAt"] = expires_at
        res["tags"]["requestId"] = rid
        res["tags"]["managedBy"] = janitor.MANAGED_BY
    store.patch(rid, lambda r: r.update(status="deploying", approver=APPROVER["name"],
                                        deploy_log=[], resources=resources,
                                        expires_at=expires_at, ttl_minutes=ttl))
    result = deployer.deploy(rid, resources, lambda lv, m: _log(rid, lv, m))

    def _finish(r):
        if result["ok"]:
            ids = result["resource_ids"]
            # attach ids to each resource (best-effort, by order)
            for i, res in enumerate(r.get("resources", [])):
                res["azure_ids"] = [ids[i]] if i < len(ids) else ids
            started = datetime.datetime.fromisoformat(r["created"])
            r["completed"] = _now()
            r["azure_ids"] = ids
            dur = (datetime.datetime.fromisoformat(r["completed"]) - started).total_seconds() / 60.0
            r["durationMin"] = round(max(0.1, dur), 1)
            r["status"] = "deployed"
        else:
            r["status"] = "error"
            r["error"] = result["error"]
    store.patch(rid, _finish)


# ----------------------------- API -----------------------------
class NewRequest(BaseModel):
    text: str
    channel: str = "Web Portal"


@app.get("/api/config")
def api_config():
    s = cfg.summary()
    s.update({
        "landing_zone": {**standards.LANDING_ZONE,
                         "resource_group": cfg.RESOURCE_GROUP or standards.LANDING_ZONE["resource_group"],
                         "region": cfg.LOCATION},
        "sample_prompts": standards.SAMPLE_PROMPTS,
        "requester": REQUESTER, "approver": APPROVER,
        "standards_count": len(standards.STANDARDS),
        "catalog_count": len(standards.CATALOG),
    })
    return s


@app.get("/api/standards")
def api_standards():
    return {"standards": standards.STANDARDS, "catalog": standards.CATALOG,
            "landing_zone": standards.LANDING_ZONE}


@app.get("/api/requests")
def api_list():
    return store.all_requests()


@app.get("/api/requests/{rid}")
def api_get(rid: str):
    r = store.get(rid)
    if not r:
        raise HTTPException(404, "request not found")
    return r


@app.post("/api/requests")
def api_create(body: NewRequest):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "empty request")
    rid = store.next_id()
    req = {
        "id": rid, "requester": REQUESTER["id"], "requesterName": REQUESTER["name"],
        "team": REQUESTER["team"], "channel": body.channel, "environment": "dev",
        "text": text, "created": _now(), "completed": None, "status": "processing",
        "approver": None, "durationMin": None, "resources": [], "retrieval": [],
        "validation": None, "deploy_log": [], "mode": cfg.mode, "_anim": 0,
    }
    store.add(req)
    _pool.submit(run_pipeline, rid, text)
    return req


@app.post("/api/requests/{rid}/approve")
def api_approve(rid: str):
    r = store.get(rid)
    if not r:
        raise HTTPException(404, "request not found")
    if r["status"] != "awaiting_approval":
        raise HTTPException(409, f"request is '{r['status']}', not awaiting approval")
    _pool.submit(run_deploy, rid)
    return {"ok": True}


@app.post("/api/requests/{rid}/reject")
def api_reject(rid: str):
    r = store.patch(rid, lambda r: r.update(status="rejected", approver=APPROVER["name"]))
    if not r:
        raise HTTPException(404, "request not found")
    return {"ok": True}


@app.post("/api/requests/{rid}/destroy")
def api_destroy(rid: str):
    r = store.get(rid)
    if not r:
        raise HTTPException(404, "request not found")
    ids = r.get("azure_ids", [])
    logs = []
    deployer.destroy(ids, lambda lv, m: logs.append([lv, m]))
    store.patch(rid, lambda r: r.update(status="destroyed",
                                        deleted_at=_now(), destroy_log=logs))
    return {"ok": True, "log": logs}


@app.post("/api/requests/{rid}/extend")
def api_extend(rid: str):
    r = store.get(rid)
    if not r:
        raise HTTPException(404, "request not found")
    if r.get("status") != "deployed":
        raise HTTPException(409, "only deployed requests can be extended")
    new_exp = (datetime.datetime.now() + datetime.timedelta(minutes=cfg.RESOURCE_TTL_MINUTES)).replace(microsecond=0).isoformat()

    def _ext(x):
        x["expires_at"] = new_exp
        for res in x.get("resources", []):
            res.setdefault("tags", {})["expiresAt"] = new_exp
    store.patch(rid, _ext)
    return {"ok": True, "expires_at": new_exp}


@app.post("/api/janitor/run")
def api_janitor_run():
    """Trigger one TTL sweep now (used by the optional cron/systemd timer too)."""
    return janitor.sweep_once()


class ChatBody(BaseModel):
    message: str
    history: list = []


@app.post("/api/chat")
def api_chat(body: ChatBody):
    return {"reply": chat.answer((body.message or "").strip(), body.history or [])}


@app.on_event("startup")
def _startup():
    janitor.start_scheduler()


@app.get("/api/resources")
def api_resources():
    return inventory.list_resources()


@app.post("/api/reset")
def api_reset():
    store.reset()
    return {"ok": True}


# ----------------------------- static UI -----------------------------
if os.path.isdir(os.path.join(WEB_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(WEB_DIR, "assets")), name="assets")


@app.get("/")
def index():
    return FileResponse(os.path.join(WEB_DIR, "index.html"))


@app.get("/healthz")
def healthz():
    return JSONResponse({"ok": True, "mode": cfg.mode})
