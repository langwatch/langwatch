#!/bin/bash
set -e

# This script runs ONCE at pod startup. It seeds /workspace (an emptyDir
# volume in k8s, so image content there is shadowed) with the shared
# templates baked into the image at /opt/langy-templates: the skill
# how-to files plus AGENTS.md. The manager (server.js) copies these into
# each per-conversation worker home at spawn time. The opencode
# config.json is NOT written here — the manager writes one per worker
# with that worker's credentials injected. We also do NOT start
# opencode here; the manager spawns one opencode subprocess per
# session on first message.
#
# AGENTS.md keeps ${LANGWATCH_ENDPOINT} as a literal placeholder. The
# manager substitutes it per-worker when it writes the worker-local
# AGENTS.md at spawn time (since LANGWATCH_ENDPOINT is now a
# per-session credential, not a pod-level env).

mkdir -p /workspace/skills
cp /opt/langy-templates/skills/*.md /workspace/skills/
cp /opt/langy-templates/AGENTS.md /workspace/AGENTS.md

# Workers run as distinct non-root UIDs (see server.js workerUidFor); the
# shared templates must be readable by all of them. World-readable +
# root-owned + only-root-writable is the safest combination: any worker
# UID can open(2) these for read, but no worker can modify them. The
# manager wipes /workspace/sessions on startup separately (server.js).
chown -R root:root /workspace/skills /workspace/AGENTS.md
chmod -R a+rX,go-w /workspace/skills /workspace/AGENTS.md

exec "$@"
