#!/usr/bin/env bash
# Linux / macOS launcher.  Usage:  bash run.sh   (or ./run.sh after chmod +x)
set -e
cd "$(dirname "$0")"
# On a server/VM, expose to the network with:  HOST=0.0.0.0 bash run.sh
exec python3 run.py
