#!/bin/bash
# Starts Plexo Prompter on a Mac. Double-click this file in Finder.
cd "$(dirname "$0")" || exit 1

# Python from python.org, Homebrew, or Apple's developer tools, in that order.
PYTHON=""
for candidate in /usr/local/bin/python3 /opt/homebrew/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
  if [ -x "$candidate" ]; then PYTHON="$candidate"; break; fi
done
if [ -z "$PYTHON" ] && xcode-select -p >/dev/null 2>&1; then PYTHON=/usr/bin/python3; fi

if [ -z "$PYTHON" ] || ! "$PYTHON" -c "import sys; sys.exit(sys.version_info < (3, 8))" >/dev/null 2>&1; then
  echo
  echo "  Plexo Prompter needs Python, a free program from python.org."
  echo "  It isn't installed on this Mac yet."
  echo
  echo "  The download page will open now. Install Python, then"
  echo "  double-click \"Start Plexo Prompter\" again."
  echo
  open "https://www.python.org/downloads/"
  exit 1
fi

echo
echo "  Plexo Prompter is running. You can minimise this window, but leave it open."
echo "  It closes by itself about a minute after you close the prompter."
echo
exec "$PYTHON" prompter_server.py "$@"
