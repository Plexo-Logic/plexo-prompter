#!/bin/bash
# Starts Plexo Prompter on a Mac. Double-click this file in Finder.
# If Python isn't installed, it explains why it's needed and offers to install it.
cd "$(dirname "$0")" || exit 1

PYTHON_VERSION="3.14.10"
INSTALLER_URL="https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-macos11.pkg"

# Python from python.org, Homebrew, or Apple's developer tools, in that order. Sets PYTHON.
find_python() {
  PYTHON=""
  for candidate in /usr/local/bin/python3 /opt/homebrew/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    if [ -x "$candidate" ]; then PYTHON="$candidate"; break; fi
  done
  if [ -z "$PYTHON" ] && xcode-select -p >/dev/null 2>&1; then PYTHON=/usr/bin/python3; fi
  [ -n "$PYTHON" ] && "$PYTHON" -c "import sys; sys.exit(sys.version_info < (3, 8))" >/dev/null 2>&1
}

open_download_page() {
  echo
  echo "  The Python download page will open now. Install Python, then"
  echo "  double-click \"Start Plexo Prompter\" again."
  echo
  open "https://www.python.org/downloads/macos/"
  exit 1
}

if ! find_python; then
  echo
  echo "  Plexo Prompter needs Python, a free program from python.org, to run on"
  echo "  your Mac. It isn't installed yet."
  echo
  printf "  Download and install Python now? It's about 75 MB. [Y/n] "
  read -r answer
  case "$answer" in [nN]*) open_download_page ;; esac

  installer="${TMPDIR:-/tmp}/python-$PYTHON_VERSION.pkg"
  echo
  echo "  Downloading Python $PYTHON_VERSION from python.org..."
  curl -fL --progress-bar -o "$installer" "$INSTALLER_URL" || { echo "  The download didn't work."; open_download_page; }

  echo
  echo "  The Python installer is opening. Click Continue, then Install, and enter"
  echo "  your Mac's password if it asks. Plexo Prompter starts by itself when it's done."
  open "$installer"

  # Wait for the installer to finish (up to 20 minutes), then carry on.
  for _ in $(seq 1 240); do
    sleep 5
    if find_python; then break; fi
  done
  find_python || { echo; echo "  Python isn't installed yet. When it is, double-click \"Start Plexo Prompter\" again."; exit 1; }
  rm -f "$installer"
  echo
  echo "  Python is ready."
fi

echo
echo "  Plexo Prompter is running. You can minimise this window, but leave it open."
echo "  It closes by itself about a minute after you close the prompter."
echo
exec "$PYTHON" prompter_server.py "$@"
