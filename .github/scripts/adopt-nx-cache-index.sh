#!/usr/bin/env bash
# Nx restores only the artefacts its SQLite index knows, and names that index
# after the machine ID, so an index restored from another runner is never read
# and every artefact is "unrecognised". This renames the restored index to the
# name Nx gives this machine. Usage: adopt-nx-cache-index.sh <workspace-data dir>
set -euo pipefail

dir=$1
probe=$(mktemp -d)
trap 'rm -rf "${probe:?}"' EXIT
if ! node -e 'require("nx/src/native").connectToNxDb(process.argv[1])' "$probe"; then
  echo "::warning::Could not ask Nx for this machine's index name; the Nx cache starts cold."
  exit 0
fi
mine=$(basename "$(ls "$probe"/*.db)" .db)

for db in "$dir"/*.db; do
  [ -e "$db" ] || continue
  theirs=$(basename "$db" .db)
  if [ "$theirs" = "$mine" ]; then continue; fi
  for suffix in .db .db-wal .db-shm; do
    if [ -e "$dir/$theirs$suffix" ]; then mv -f "$dir/$theirs$suffix" "$dir/$mine$suffix"; fi
  done
  echo "Adopted the restored Nx cache index $theirs as $mine."
done
