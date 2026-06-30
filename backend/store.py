"""Tiny thread-safe request store with JSON-file persistence.

Replaces the front-end's localStorage: the server is now the source of truth.
"""
import os
import json
import threading
import datetime

_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
_PATH = os.path.join(_DATA, "requests.json")
_lock = threading.RLock()
_state = {"requests": [], "seq": 0}


def _load():
    global _state
    if os.path.exists(_PATH):
        try:
            with open(_PATH, encoding="utf-8") as f:
                _state = json.load(f)
        except Exception:
            _state = {"requests": [], "seq": 0}


def _save():
    os.makedirs(_DATA, exist_ok=True)
    tmp = _PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_state, f, indent=2, default=str)
    os.replace(tmp, _PATH)


_load()


def next_id():
    with _lock:
        _state["seq"] += 1
        n = _state["seq"]
        _save()
    today = datetime.date.today()
    return f"req-{today.year}-{today.strftime('%m%d')}-{n:03d}"


def add(req):
    with _lock:
        _state["requests"].insert(0, req)
        _save()
    return req


def get(rid):
    with _lock:
        return next((r for r in _state["requests"] if r["id"] == rid), None)


def patch(rid, fn):
    """Apply fn(req) under lock and persist."""
    with _lock:
        r = next((r for r in _state["requests"] if r["id"] == rid), None)
        if r is not None:
            fn(r)
            _save()
        return r


def all_requests():
    with _lock:
        return list(_state["requests"])


def deployed_resources():
    out = []
    for r in all_requests():
        if r.get("status") == "deployed":
            for res in r.get("resources", []):
                out.append({"res": res, "req": r})
    return out


def reset():
    global _state
    with _lock:
        _state = {"requests": [], "seq": 0}
        _save()
