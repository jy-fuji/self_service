#!/usr/bin/env python3
"""One-shot TTL sweep — delete expired resources, then exit.

The app already runs an in-process janitor, so this is an optional belt-and-
suspenders that runs even if the app is down. Wire it to cron or a systemd
timer (see deploy/). Uses the same .env / credentials as the app.

    python cleanup.py
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend import janitor  # noqa: E402


def main():
    summary = janitor.sweep_once(lambda lv, m: print(f"[{lv}] {m}"))
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
