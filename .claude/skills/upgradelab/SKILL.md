---
name: upgradelab
description: "Run the upgrade test harness in tools/upgradelab: build it, produce a snapshot of main, run a matrix cell (one old release upgraded to head under traffic), pick a deployment, tier and shape, read the checks (I*, N*, O1, B1, H*, E*, D*, A*) and the report, and keep the machine quiet. Use when someone says 'upgradelab', 'run an upgrade cell', 'upgrade matrix', 'upgrade snapshot', 'produce a snapshot', 'cell -from-snapshot', 'upgrade test', 'does the upgrade hold under traffic', 'I2b', 'N3 lost write', 'report.md', 'report.json', '-head-dir', '-settle-within', '-max-load', '-walk-every', 'run-dir', 'upgrade rehearsal', or 'void run'."
user-invocable: true
---

# upgradelab

The Go harness that upgrades a real old release to this checkout's head on a throwaway stack, with traffic running, and
judges the result. Source `tools/upgradelab/` (README beside it); specs `specs/upgrade/upgrade-matrix.feature`,
`upgrade-snapshots.feature`, `upgrade-snapshot-generation.feature`. How the upgrade itself works is the `upgrade` skill.
It replaces `dev/scripts/upgrade-rehearsal/` as it covers more.

## Before you start

1. **A quiet machine.** Timings are the point. The cell refuses to start when the one-minute load is above `-max-load`
   (default 40; `0` never refuses). A run started or finished above 40 is void: do not record it as a failure; wait and rerun.
   Check `uptime` first. Heavy builds run through the haven gate; do not run a cell beside a typecheck or a test run.
2. **Two checkouts, neither holding a `.env`.** `-from-dir` (default `.worktrees/upgradelab-main`, the release upgraded from)
   and `-head-dir` (default `.worktrees/upgradelab-head`, the release upgraded to). Worktree hooks copy a `.env` in: delete it.
   Never point either flag at a directory with a `.env`, and never read one; the cell builds each process's environment from
   `seed/env/<shape>.env` and its own stores. `tools/upgradelab/sync-head.sh` brings the head checkout up to this tree.
3. **Haven's native Postgres and ClickHouse are running** (`haven db url` supplies the credentials). Each cell gets its own
   `upgradelab_<cell>` databases and its own `redis-server`; nothing touches the stack's data.
4. **Built, not dev.** Both sides run built code under `NODE_ENV=production`; a build is skipped while
   `node_modules/.upgradelab-build` records the checkout's commit.

```bash
go build -o .bin/upgradelab/upgradelab ./cmd/upgradelab        # from the repo root; binaries go in .bin
```

## The commands

| Command                                             | Does                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `cell`                                              | one matrix cell: seed (or restore) main, traffic through a balancer, upgrade to head, judge                 |
| `produce`                                           | build and seed main, run traffic, pause its worker so jobs queue, capture every store into a snapshot entry |
| `drill`                                             | a single failure drill against a cell (`cell.DrillCommand`)                                                 |
| `generate`                                          | print or run the data plan for a shape and capture it                                                       |
| `snapshot capture / restore / fingerprint / verify` | the snapshot format on its own; restore refuses any database not named `upgradelab_<name>` or not empty     |

```bash
.bin/upgradelab/upgradelab cell -deployment cloud -tier S -shape typical -seed 1
.bin/upgradelab/upgradelab produce -deployment cloud -tier S                        # once per main commit and shape
.bin/upgradelab/upgradelab cell -deployment cloud -tier S -from-snapshot <entry dir or cache key>
```

Snapshots land in `${XDG_CACHE_HOME:-~/.cache}/langwatch/upgrade-snapshots/<key>` (key = deployment, tier, shape, seed, main
commit, recipe version); a cached key is skipped unless `-force`. Snapshots are public and synthetic only; the scrub refuses
key and token shapes.

## The flags you use

| Flag                                 | Meaning                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-deployment`                        | `cloud`, `cloud-sso`, `cloud-legacy-sso`, `hybrid`, `self-hosted`, `self-hosted-legacy-sso`. Cloud and hybrid roll (head's api starts beside the old release, the balancer switches); self-hosted stops first |
| `-tier`                              | `S`, `M`; `L` makes snapshots only (README says L and XL are not built; trust `cell/command.go`)                                                                                                              |
| `-shape`                             | `typical`, or `empty` (a fresh install: no seed, no traffic)                                                                                                                                                  |
| `-seed`                              | seed for every generated id and payload                                                                                                                                                                       |
| `-from-snapshot`                     | restore a produce entry instead of seeding                                                                                                                                                                    |
| `-from-dir`, `-head-dir`, `-via-dir` | the two checkouts, and an optional middle release the operator upgrades to first                                                                                                                              |
| `-before`, `-at-cut`, `-after-ready` | traffic windows (30 s, 10 s with the old worker paused, 20 s)                                                                                                                                                 |
| `-ready-within`                      | bound on each boot and on head becoming ready (6 m)                                                                                                                                                           |
| `-settle-within`                     | bound on background steps and queues settling (4 m); large tiers need more                                                                                                                                    |
| `-worker-delay`                      | head's api starts this long before its worker (10 s)                                                                                                                                                          |
| `-switch-on`                         | what head must answer 200 to before the balancer switches (`/readyz`)                                                                                                                                         |
| `-drills`, `-overlays`               | extra failure drills (`api-early`, `worker-restart`, `retry`, `private-down`, `route-broken`, `old-worker-lingers`) and planted data (`retention`, `tenant-oddities`, `operator-damage`)                      |
| `-walk-every`                        | the browser walker's pause between rounds (10 s); lengthen it to cut Chromium's CPU                                                                                                                           |
| `-max-load`                          | refuse above this load average (40)                                                                                                                                                                           |
| `-run-dir`                           | where logs, screenshots and the report go; default `<cell>-<time>` under the gitignored upgradelab scratch folder                                                                                             |
| `-keep`                              | keep the databases (kept anyway when a step fails)                                                                                                                                                            |
| `-ledger`, `-tested-by`              | claim and report rows in the tested-flow ledger (`lane:<id>` or `@handle`)                                                                                                                                    |

## Reading the result

Exit 0 all checks pass, 1 an invariant failed, 2 a step stopped the cell (databases kept). `report.md` and `report.json` sit
in the run dir with `shots/` and logs. The table lists each check; "inconclusive" is not a pass. The ones you meet most:

- **I0** the api serves from boot, no holding page. **I2** ledger current, **I2b** nothing reopened after ready. **I3** api
  ready and the roster declares the image's steps. **I4** copy never move (no table lost rows). **I5** read models filled.
  **I6** seeded kinds read back. **I7** stored events parse and upcast. **I8** a second upgrade changes no ledger row.
  **I9** no error lines in head's logs.
- **N1** head's api answers before the upgrade is done. **N2** every call eventually succeeds (retry after Retry-After).
  **N3** no lost write. **N4** queued work drains once head's worker runs. **N5** ingest never answers a non-2xx.
  **N6** no unanswered call. **N7** the early api never exits before ready.
- **O1** Ops > Upgrades shows the right state. **B1** no console error or failed request in the browser walk.
- **H1-H9** private ClickHouse and S3 targets (hybrid). **E1-E15** sign-in, SSO, SCIM, roles, licence carry-over.
  **D1-D3** failure drills. **A1-A4** tenant oddities. **Q1** queued jobs in main's format. **R1/R2** aged data. **U1-U6**
  the operator guide and pages. The full list with names is `invariantNames` in `tools/upgradelab/cell/report.go`.

A failing check is a finding about head or about the check; read the cell's logs (`I9`) before deciding. Record the result by
failing ids, not by counts.

## Limits and traps

- The README's "not yet" list lags the code (snapshot restore as a cell origin works; `cell/command.go` is the truth).
- A head api that exits before ready is restarted, as an orchestrator would, and counted (N7).
- Never run two cells at once on one machine unless the load stays under the cap; each runs a balancer, two stores and a browser.
- `go build` for the harness is a build: run it only when the machine is quiet. Test the harness with `go test ./tools/upgradelab/...` from `tools/`.
