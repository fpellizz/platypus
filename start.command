#!/bin/bash
# Agent Office: doppio clic nel Finder per avviare (macOS)
cd "$(dirname "$0")" || exit 1
./start.sh --background "$@"
status=$?
[ $status -ne 0 ] && read -n 1 -s -r -p "Premi un tasto per chiudere · press any key"
exit $status
