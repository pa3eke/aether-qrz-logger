#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is nodig om dit logboek te starten."
  read -r "?Druk op Enter om te sluiten."
  exit 1
fi
python3 server.py
read -r "?Druk op Enter om te sluiten."
