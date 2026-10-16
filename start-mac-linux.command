#!/bin/bash
# Doppelklick auf dem Mac oder ./start-mac-linux.command im Terminal
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ist nicht installiert. Bitte einmalig die LTS-Version von https://nodejs.org installieren."
  read -r -p "Enter zum Schließen"
  exit 1
fi
node server.js
