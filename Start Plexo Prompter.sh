#!/bin/sh
# Starts Plexo Prompter on Linux. Double-click this file and choose Run,
# or open a terminal in this folder and type:  python3 prompter_server.py
cd "$(dirname "$0")" || exit 1

if ! python3 -c "import sys; sys.exit(sys.version_info < (3, 8))" >/dev/null 2>&1; then
  echo "Plexo Prompter needs Python 3.8 or later."
  echo "Install it from your software centre, or with:  sudo apt install python3"
  xdg-open "https://www.python.org/downloads/" >/dev/null 2>&1
  exit 1
fi

exec python3 prompter_server.py "$@"
