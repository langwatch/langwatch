# ADR-176: VM-free macOS development stack

**Date:** 2026-10-09

**Status:** Accepted

**Related:** [ADR-004](004-docker-dev-environment.md) (container dev environment; Colima was its macOS
runtime), [ADR-042](042-local-observability-stack.md) (local logs, traces and metrics in Grafana),
[ADR-090](090-machine-wide-resource-governance-for-parallel-agents.md) (machine-wide resource
governance), [ADR-168](168-one-process-dev-with-debounced-module-reload.md) (one-process dev with
in-process reload), `dev/docs/LOCAL_STACK.md`, `specs/setup/haven-clickhouse-native.feature`,
`specs/setup/haven-observability-native.feature`, `specs/setup/haven-install-prerequisites.feature`.

## Context

On macOS the dev stack kept a Colima VM running only for ClickHouse and the LGTM observability
container. Postgres, Redis and langevals already ran on the host. The VM held a fixed share of
RAM (roughly 2.5 GB resident, 8 GiB configured) beside every parallel worktree, which ADR-090
treats as the scarce resource. Estimated steady-state saving from dropping it: 1.5 to 2.0 GB.

Two further costs sat on the same path. Storybook and the mail preview were started eagerly by
haven, and the backend reload held changes for the length of an agent turn. Alex's rulings of
2026-10-09 close all of these.

## Decision

1. **macOS dev runs VM-free by default.** ClickHouse is a native process on a pinned 25.8 LTS
   build. Grafana, Prometheus and Loki come from Homebrew. Tempo and Alloy are pinned downloads.
   Observability stays on by default. Pyroscope is dropped from the native tier.
2. **Colima is an opt-in fallback** for container-only features. `HAVEN_CH_RUNTIME=container`
   selects the ClickHouse container; the LGTM container remains the observability fallback. Linux
   keeps containers where no binary is pinned.
3. **Pinned, sha256-checked downloads are the mechanism for binaries Homebrew cannot pin.** One
   shared helper (`tools/thuishaven/adapters/pinnedrelease`) downloads to a temp file, hashes while
   writing, renames into place only on a match, and unpacks a tar.gz member when one is named.
   Digests are GitHub's recorded asset digests. Pins today: ClickHouse 25.8.33.6-lts and
   Tempo 3.1.0 (newest release with darwin assets and digests). Alloy is pinned the same way.
   `HAVEN_OBS_*_BIN` overrides a download.
4. **`make haven install` installs the native tier unattended** (now `make haven self install`). Without a TTY it runs
   `haven install --yes` (now `haven self install --yes`): the Homebrew formulae, then every missing pinned binary. A failure of a
   non-required item is printed and skipped; `haven up` still runs.
5. **Storybook and the mail preview are lazy and owned by the UI dev server.** They start on the
   first request to their port and stop after idle (`LANGWATCH_DEV_TOOLS_IDLE`, `off` pins). Not
   everyone uses haven, so the capability must work under plain `pnpm dev` and be
   haven-enhanced, not haven-only.
6. **The backend reloads changed modules in-process** (ADR-168) and the agent-turn hold is
   retired. Only the debounce remains (quiet window plus max wait). `haven hmr` is a no-op that
   says so.

## Consequences

- No VM resident by default; the saving is measured per machine, not assumed.
- Native ClickHouse loses the cgroup ceiling. `max_server_memory_usage` and small caches bound it
  as an engine limit; resident memory is read from the owned pid (`ps`), not `system` tables.
- Native observability takes over the LGTM container's host ports: the container is stopped
  (never removed, never starting Colima) and a port held by anything else is named in `up` and
  `status`.
- Retention is capped natively; Tempo 3.x config differs from the 2.x keys in ADR-042 (no
  `compactor`, `backend_worker.compaction`).
- First `make haven install` downloads two to three binaries; later runs are offline.
- Bumping a pin is a code change with a new digest, reviewed like any dependency.
- Container-only features need `colima start` by hand.

## Alternatives considered

- **Docker Desktop instead of Colima.** Same VM, same resident cost, plus a licence question;
  it replaces the runtime rather than removing it.
- **OpenObserve as one native observability binary.** Fewer processes, but drops Grafana, the
  provisioned datasources and the Loki/Tempo query surface agents and ADR-042 already rely on.
- **Victoria stack (metrics, logs, traces).** Native and light, but the same loss of the Grafana
  datasource contract and a new query language for agents to learn.
- **Homebrew ClickHouse cask.** Tracks latest upstream and cannot be pinned to an LTS series.
- **Keep the VM and trim it.** Smaller, but a VM still holds guest memory beside every worktree.
