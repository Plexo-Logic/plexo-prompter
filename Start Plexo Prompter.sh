#!/bin/sh
# Starts Plexo Prompter on Linux. Double-click this file and choose Run,
# or open a terminal in this folder and type:  python3 prompter_server.py
cd "$(dirname "$0")" || exit 1

if ! python3 -c "import sys; sys.exit(sys.version_info < (3, 8))" >/dev/null 2>&1; then
  # Installing needs an administrator password in a terminal, so give the exact command instead.
  if command -v apt >/dev/null 2>&1; then how="open a terminal and type:  sudo apt install python3"
  elif command -v dnf >/dev/null 2>&1; then how="open a terminal and type:  sudo dnf install python3"
  elif command -v pacman >/dev/null 2>&1; then how="open a terminal and type:  sudo pacman -S python"
  elif command -v zypper >/dev/null 2>&1; then how="open a terminal and type:  sudo zypper install python3"
  else how="open your software centre and search for Python 3."
  fi
  message="Plexo Prompter needs Python 3.8 or later, a free program, to run on your computer.

To install it, $how

Then start Plexo Prompter again."
  printf '\n%s\n\n' "$message" >&2
  # Started by double-clicking, with no terminal to show it: put it in a window instead.
  if [ ! -t 2 ]; then
    if command -v zenity >/dev/null 2>&1; then
      zenity --info --title="Plexo Prompter" --text="$message" 2>/dev/null
    elif command -v kdialog >/dev/null 2>&1; then
      kdialog --title "Plexo Prompter" --msgbox "$message" 2>/dev/null
    fi
  fi
  exit 1
fi

exec python3 prompter_server.py "$@"
