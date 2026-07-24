# thuishaven (`haven`)

_Home port._ A tiny Go orchestrator that gives every LangWatch dev stack a stable
**hostname** instead of a raw port — so worktrees never fight over ports again.

Built on [portless](https://github.com/vercel-labs/portless): a local reverse
proxy that maps hostnames to loopback ports. `.localhost` resolves to `127.0.0.1`
natively (in browsers, curl, Go, Node), so there is **no `/etc/hosts`, no DNS, no
sudo** for name resolution.

## The scheme

Each worktree's slug is simply its own directory name, sanitised (a checkout at
`.../worktrees/portless` is the `portless` stack), cached in `.langwatch-slug`.
Predictable hostnames, not a random `happy-tiger`. Its services are reached at:

| Hostname | Service |
| --- | --- |
| `app.<slug>.langwatch.localhost` | App — the UI, **and its API at `/api`** |
| `gateway.<slug>.langwatch.localhost` | AI Gateway (Go) |
| `nlp.<slug>.langwatch.localhost` | NLP engine (Go) |
| `clickhouse.<slug>.langwatch.localhost` | ClickHouse — this stack's own database |

The **app and its API are one origin**: open `app.<slug>.langwatch.localhost` for
the UI and hit `app.<slug>.langwatch.localhost/api` for the API. There is no
separate `api.<slug>` hostname — the frontend and backend never split into two
confusable URLs. Vite serves the SPA and proxies `/api` (plus `/mcp`, `/sse`,
`/oauth`, `/.well-known/*`) to the API backend on loopback.

Shared, machine-wide (one daemon serves all worktrees):

| Hostname | What |
| --- | --- |
| `langwatch.localhost` | Dashboard — which worktree runs what |
| `observability.langwatch.localhost` | The local Grafana LGTM stack (:3000) |
| `telemetry.langwatch.localhost` | OTLP fan-out to **every** running stack |

## Setup

There is none. The first `haven up` bootstraps the machine itself: installs
portless if missing, trusts its CA, starts the proxy — every step idempotent.
`make haven install` (optional) go-installs the binary so plain `haven ...`
works everywhere. Hostname routing is opt-in — `pnpm dev` uses the plain
`PORT` scheme:

```bash
haven up                 # registers hostnames, starts + supervises the stack
haven up +workers        # …with a standalone workers lane (sticky, per worktree)
```

Open <https://langwatch.localhost> to see every stack across your worktrees.

## Commands

One name per command, one meaning per flag, no aliases (ADR-064). The daily
surface is six verbs; `db` and `clean` are the only destructive nouns.

```text
haven            the hub: every stack + actions on the selected one (agents/pipes
                 get the plain status report)
haven up         start or reconcile this worktree's stack — in a terminal it
                 runs in the BACKGROUND under an attached log view: ←/→/tab/digits
                 switch between "all" and per-service logs, q detaches (the stack
                 keeps running; haven down stops it). +svc/-svc picks services and
                 sticks (+langy, -nlp, +workers, -gateway); a fresh worktree runs
                 app + nlp + gateway, langy off. -w watches the Go services via
                 air; -d detaches without the view; --rebuild forces images
haven down       stop this worktree's stack — data is always kept;
                 --all stops every stack, the shared servers, daemon, and proxy
haven restart    bounce one supervised service (or all) in place; `restart obs`
                 bounces the observability stack; `restart langy --rebuild`
                 re-images first
haven logs       captured service logs from any terminal, attached or detached:
                 all interleaved, `haven logs nlp` filters, -t tails,
                 --since 10m windows, --level warn filters severity,
                 --stack <slug> reads another worktree, `logs obs` streams LGTM
haven status     one-shot report: selection, per-service health, shared servers,
                 RAM footprints (--json for machines)
haven db         this stack's data: `db seed [preset]` (reseed in place, drops
                 nothing) · `db reset [preset]` (fresh database, confirmed;
                 --yes for scripts) · `db url [engine]`. Presets: demo, traces,
                 onboarding, post-onboarding, bare
haven clean      one cleanup: interactive worktree picker + safe reclaim
                 (build artifacts, orphaned processes); --yes applies only the
                 safe categories
haven pr <ref>   try a GitHub PR in a fresh worktree (--allow-closed,
                 --allow-scripts)
haven play [pr]  run a PR in a throwaway sandbox: own checkout, own
                 Postgres/ClickHouse/Redis containers, own play-<n> hostname.
                 Quitting the view DESTROYS everything it created, every time.
                 No argument opens a picker of open PRs (terminal only).
                 Trust-gated: every commit author must have write access, or
                 an explicit y/N confirmation (--allow-untrusted in agent mode)
haven git        embedded git TUI (moron) for any worktree — `haven git <slug>`
haven switch     print a worktree's dir by name; with `eval "$(haven shell-init)"`
                 it becomes a real cd, tab-completed
haven shell-init emit that shell function + completion
haven hmr        AI-gated HMR: `on [--ttl 30s]` defers Vite reloads, `off` resumes
haven typecheck  pnpm typecheck under a machine-wide RAM slot
haven upgrade    reinstall the haven binary from this checkout
haven help       exhaustive, copy-pasteable reference
```

**Service selection.** `haven up +langy` / `haven up -nlp` — sticky per
worktree (`.haven.json`), shown by `status`, remembered across terminals and
reboots. A running stack reconciles: matching selection is a no-op, a changed
one replaces the stack in place. langy is off by default (it costs a container
image and a hard memory cap); the worktrees that need it say `+langy` once.

**Automatic preparation.** `up` owns the whole path from a fresh machine to a
running stack: portless install + CA trust, `pnpm install` when the lockfile
changed, database create + migrate + seed, recovery of a wedged ClickHouse
container (data kept), and content-addressed langy images — rebuilt only when
the Dockerfile or a COPY source actually changed, pulled from CI when
`HAVEN_LANGY_IMAGE_REGISTRY` is set, `--rebuild` to force. A failed migration
stops the up and names the one recovery command (`haven db reset`); nothing is
ever dropped silently.

**Logs.** The supervisor captures every service's output to per-service,
size-capped files whether the stack runs attached or detached — so `haven
logs` works from any terminal, filters by plain argument, and still reads
after a crash or a `down`.

**The hub.** Bare `haven` opens the interactive fleet view:
every stack with its liveness, branch, service health, and RAM footprint.
Actions run on the selected stack — enter/`g` opens its git view (and returns
to the hub on quit), `d` shuts it down keeping its databases, and `x` destroys
the worktree entirely: stack stopped, ClickHouse + Postgres databases dropped,
directory deleted, confirmed by typing the stack's name. The primary checkout
and the worktree haven runs from can never be destroyed.

**Seeding.** `haven db seed` reseeds in place — an idempotent upsert that can
only add or refresh, never discard — and `haven db reset` is the destructive
sibling that starts from a fresh, migrated database. Both take a preset:
`demo` marks the project past onboarding and ingests deterministic sample
traces + realistic platform lifecycles through the running stack's real
collector (the stack must be up; re-running is idempotent), `traces` ingests
just the sample traces, `onboarding` / `post-onboarding` flip the first-trace
flag, and `bare` seeds the identity alone. `mass` is demo plus months of
backdated activity (`HAVEN_SEED_MONTHS`, default 3): event-sourced products
are seeded through their event logs with backdated `occurredAt` and replayed
by the projection workers — read models are never written directly — while
traces ingest through the collector inside its 31-day window.

**Resource caps.** Everything haven manages is bounded: the ClickHouse
container and the observability stack are memory-capped (and their colima VM is
sized at creation), and the managed Redis gets a `maxmemory` ceiling
(`HAVEN_REDIS_MAXMEMORY_MB`, default 512, `0` disables) so a leaky stack fails
loudly instead of paging the machine. `haven status` shows each service's
current memory use, and the hub + dashboard show each stack's RAM footprint.

**Playing a PR.** `haven play 4913` reviews a PR without letting it near your
own stacks: a dedicated checkout under the haven home, dedicated database
containers and volumes (play-scoped names, freshly allocated ports, never the
shared servers or volumes), migrated and seeded, served at
`app.play-4913.langwatch.localhost` under the same attached log view as `up`.
The defining difference from `up`: quitting the view destroys everything the
sandbox created, always. That is the contract, disclosed up front, so no
`--yes` is asked at teardown. Before anything is checked out, a trust gate
collects every commit author and committer on the PR and checks their write
access; anyone without it (including commits with no GitHub account) stops
play for an explicit default-no confirmation, and in agent mode only
`--allow-untrusted` proceeds. If a play dies hard, `haven clean` finds its
record and finishes the teardown.

**Git across worktrees.** `haven git` opens [moron](https://github.com/0xdeafcafe/moron)
in-process (a Go module dependency — nothing extra to install) for the current
worktree; pass a stack slug, worktree name, or path to open another. Inside the
TUI, Enter on a branch shows its diff against HEAD without checking it out, and
Enter on a worktree re-targets the whole view at that worktree — the filesystem
is never touched. The hub page (`langwatch.localhost`) shows the same fleet with
live health, per-stack RAM, and database names.

**Destructive-operation guards.** Database drops only ever run against the
managed loopback servers, `db reset` refuses when the worktree's effective
`DATABASE_URL`/`CLICKHOUSE_URL` is non-local, uses the wrong dev user, or has a
production-looking name, and every bulk path (`clean`, worktree destruction,
the daemon's idle prune) always keeps `lw_main` — the standing database you
fall back to when a worktree doesn't need its own data.

**Agent mode.** `--agent` (or `HAVEN_AGENT=1`, `NO_COLOR`, or a non-TTY stdout)
switches to plain, colourless, redraw-free output — zero token waste when an AI
agent drives haven. `haven status --json` is the machine-readable inventory.

## Design

Hexagonal, à la `services/nlpgo`:

```
tools/thuishaven/
  domain/     pure logic — slug derivation, hostname/URL scheme, overlay (no I/O)
  app/        orchestrator + daemon; depends only on ports (interfaces)
  adapters/   portlessproxy · fileregistry · procsupervisor · system · dashboard
  cmd/        composition root: builds adapters, injects, dispatches
cmd/haven/    the installable binary (go install ./cmd/haven)
```

A single **daemon** (auto-spawned by the first `haven up`) hosts the dashboard +
telemetry fan-out, holds the cross-worktree registry (`~/.langwatch/portless/
registry/*.json`), and **reaps** stacks whose launcher has exited or whose
heartbeat has gone stale (`HAVEN_IDLE_TTL`) — pulling routes down with them.

The resolved config lands in `langwatch/.env.portless`, which every TS entry
point loads **last with `override: true`** so it beats anything pinned in `.env`
(that repo runs `dotenv.config({ override: true })`).

### Why native processes, not kind/k8s (yet)

Vite/tsx run as **native host processes** for instant HMR — running the dev
server inside a container/kind mount reintroduces the slow file-watching it
already fights. haven routes across native processes **and** containerized
backends uniformly by hostname, so a future backend swap (a shared `kind`
cluster with per-worktree Helm value overlays: standard services off `main`,
worktrees overriding select ones) is a change *behind* haven — the routing,
registry, and dashboard stay the same.

## More of what haven does

- **Managed ClickHouse.** haven runs one shared native `clickhouse-server` and
  gives every worktree its own database (`lw_<slug>`) on it — so migration counts
  are always this worktree's own. Light local config (memory cap, no S3 tiering,
  no zero-copy). The server lifecycle is automatic; `haven db url clickhouse`
  prints this stack's URL, `haven db reset` gives it a fresh database, and the
  daemon prunes databases whose worktree hasn't been up for `HAVEN_DB_TTL`
  (default 14 days).
- **Always migrate + seed, fully static identity.** Every `up` migrates *and*
  seeds idempotently. Nothing about the local dev identity is ever randomly
  generated — the same admin login, org/team/project/user IDs, and API
  tokens exist on every worktree and every machine. See the doc comment at
  the top of `langwatch/prisma/seed.ts` for the exact values (admin email +
  password, ingestion key `sk-lw-local-development-key` (override
  `LANGWATCH_LOCAL_API_KEY`), a private full-access personal access token,
  and a public ingestion-only token).
- **Shared-baseline fallback.** Every stack defines all hostnames; a service a
  worktree doesn't run itself (`haven up -gateway` / `-nlp`)
  resolves to a shared baseline stack (`HAVEN_BASELINE=1`, off `main`) instead of
  dead-ending. ClickHouse embodies this: one server, `clickhouse.<slug>` always
  resolves, only the database is per-worktree.
- **Sandboxed Langy worker (by default).** The langyagent worker runs the Langy
  agent, so haven isolates it like production rather than letting a test model run
  as your own user. Two env flags pick one of three tiers:
  - _neither_ (default): the worker runs in the shared colima VM with the
    per-worker UID sandbox on (production-like); nothing it does can touch your
    real filesystem. haven builds `langyagent:dev` into colima on first `up`
    (minutes once; `HAVEN_LANGY_REBUILD=1` forces a rebuild after source changes).
  - `LANGY_UNSAFE_CONTAINER=1`: still in the colima VM (host still isolated), but
    the per-worker UID sandbox is off — simpler/faster when iterating.
  - `LANGY_UNSAFE_HOST_ACCESS=1`: runs the worker as a bare host process, no VM,
    full host filesystem access — the least safe, for when it genuinely must reach
    host paths.

  In the container tiers the worker reaches the control plane + gateway back on the
  host via `host.docker.internal` (haven injects `LANGY_WORKER_CALLBACK_URL` /
  `LANGY_WORKER_GATEWAY_URL`), and the host reaches the manager over a published
  loopback port. Production is never any of these — it always runs sandboxed under
  gVisor.
- **`haven clean`.** One cleanup command. The interactive picker scans every
  worktree at once (git + database facts on a fast queue, disk size via `du` on
  a slow one), pre-ticks everything idle 5+ days (`--stale-days N`), lets you
  sort and tick, then removes exactly those (stack stopped, databases dropped,
  directory removed — the primary checkout, the current worktree, and `lw_main`
  are never touched), and finishes by reclaiming the safe categories:
  regenerable build artifacts of idle worktrees and orphaned dev runtimes.
  `--yes` skips the picker and applies only the safe categories. Agents (and
  any non-TTY) get the read-only report and delete nothing.
- **`haven typecheck`.** Run `pnpm typecheck` under a machine-wide slot so parallel
  tsgo runs across worktrees don't exhaust RAM (bounded by memory / CPU).
- **AI-gated HMR.** `haven hmr on [--ttl 30s] | off` defers Vite reloads while an
  agent edits, then fires one catch-up reload — a human's browser isn't thrashed
  through broken intermediate states. Opt-in and always time-bounded.

## Forward ideas

- **Per-worktree Postgres.** Today Postgres is the shared singleton and ClickHouse
  is per-slug; extending per-worktree isolation to PG would let "a new DB is always
  migrated + seeded" cover Postgres too.
- **Shared `kind` cluster.** The baseline fallback already routes across a
  heterogeneous set, so the backend can become a shared `kind` cluster with
  per-worktree Helm value overlays *behind* haven — the routing, registry, and
  dashboard stay the same.
