#!/bin/bash
set -e

# The manager is self-contained: AGENTS.md and the skills/ tree are EMBEDDED in
# the Go binary (services/langyagent/internal/assets, //go:embed). At boot the
# manager (workerpool.New) reads the AGENTS.md template from the binary and
# materializes the skills tree onto disk itself (world-readable, root-owned) under
# WorkspaceRoot/skills. There is nothing to seed here — this script used to copy
# /opt/langy-templates into the /workspace emptyDir, a startup dependency that
# could fail silently when the mount or the copy went wrong.
#
# `exec "$@"` replaces this shell with the manager so it becomes PID 1: the orphan
# reaper (workerpool.StartOrphanReaper) requires PID 1 to reap opencode's
# reparented children (gh/git/npm) after a worker kill.
exec "$@"
