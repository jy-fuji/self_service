#!/usr/bin/env python3
"""Cross-platform launcher for the Self-Service Provisioning app.

Works the same on Windows (cmd / PowerShell), Linux and macOS:

    python run.py

Environment overrides:
    HOST   bind address (default 127.0.0.1; use 0.0.0.0 on a server/VM)
    PORT   port (default 8137)
"""
import os
import sys

# Ensure the service directory (which contains the `backend` package) is importable
# regardless of the current working directory.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8137"))


def main():
    import uvicorn
    shown = "localhost" if HOST in ("127.0.0.1", "0.0.0.0") else HOST
    print(f"\n  Self-Service Provisioning  ->  http://{shown}:{PORT}")
    print("  (Ctrl+C to stop)\n")
    uvicorn.run("backend.app:app", host=HOST, port=PORT, reload=False)


if __name__ == "__main__":
    main()
