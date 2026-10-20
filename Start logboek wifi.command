#!/bin/zsh
cd -- "${0:A:h}"
python3 server.py --lan
read -r "?Druk op Enter om te sluiten."
