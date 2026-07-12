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

## One-time setup

```bash
make haven setup         # verifies/installs the portless proxy (443, trusted CA)
make haven install       # optional: go install so plain `haven ...` works everywhere
```

Then, in any worktree (hostname routing is opt-in — `pnpm dev` uses the plain
`PORT` scheme):

```bash
pnpm dev:haven           # == haven up: registers hostnames, starts + supervises the stack
pnpm dev:single:haven    # …with the workers hosted in-process (one Node process)
```

Open <https://langwatch.localhost> to see every stack across your worktrees.

## Commands

```
haven setup      one-time bootstrap — verify/install portless, trust its CA
haven            live TUI of all stacks (a terminal version of the dashboard)
haven up         what `pnpm dev:haven` runs — resolve slug, register, supervise
haven list       every stack: slug, branch, worktree, hostnames (--json too)
haven doctor     proxy / daemon / observability / stack health
haven seed       reseed this stack's database
haven down       tear this worktree's routes + registry entry down
haven help       exhaustive, copy-pasteable reference
```

**Agent mode.** `--agent` (or `HAVEN_AGENT=1`, `NO_COLOR`, or a non-TTY stdout)
switches to plain, colourless, redraw-free output — zero token waste when an AI
agent drives haven. `haven list --json` is the machine-readable inventory.

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
  no zero-copy). `haven clickhouse status|up|url|stop|drop`; `haven up` migrates
  the per-slug DB and `haven down` drops it.
- **Always migrate + seed, fully static identity.** Every `up` migrates *and*
  seeds idempotently. Nothing about the local dev identity is ever randomly
  generated — the same admin login, org/team/project/user IDs, and API
  tokens exist on every worktree and every machine. See the doc comment at
  the top of `langwatch/prisma/seed.ts` for the exact values (admin email +
  password, ingestion key `sk-lw-local-development-key` (override
  `LANGWATCH_LOCAL_API_KEY`), a private full-access personal access token,
  and a public ingestion-only token).
- **Shared-baseline fallback.** Every stack defines all hostnames; a service a
  worktree doesn't run itself (`LANGWATCH_SKIP_AIGATEWAY` / `LANGWATCH_SKIP_NLP`)
  resolves to a shared baseline stack (`HAVEN_BASELINE=1`, off `main`) instead of
  dead-ending. ClickHouse embodies this: one server, `clickhouse.<slug>` always
  resolves, only the database is per-worktree.
- **`haven prune`.** Reclaim regenerable disk (node_modules, dist, caches) from
  worktrees that are neither up nor dirty. Dry-run by default; `--yes` to act.
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
