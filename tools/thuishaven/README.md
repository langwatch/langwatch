# thuishaven (`haven`)

_Home port._ A tiny Go orchestrator that gives every LangWatch dev stack a stable
**hostname** instead of a raw port — so worktrees never fight over ports again.

Built on [portless](https://github.com/vercel-labs/portless): a local reverse
proxy that maps hostnames to loopback ports. `.localhost` resolves to `127.0.0.1`
natively (in browsers, curl, Go, Node), so there is **no `/etc/hosts`, no DNS, no
sudo** for name resolution.

## The scheme

Each worktree gets a stable, random slug (e.g. `happy-tiger`, derived from the
worktree path and cached in `.langwatch-slug`). Its services are reached at:

| Hostname | Service |
| --- | --- |
| `app.<slug>.langwatch.localhost` | Vite frontend |
| `api.<slug>.langwatch.localhost` | Hono API |
| `gateway.<slug>.langwatch.localhost` | AI Gateway (Go) |
| `nlp.<slug>.langwatch.localhost` | NLP engine (Go) |

Shared, machine-wide (one daemon serves all worktrees):

| Hostname | What |
| --- | --- |
| `langwatch.localhost` | Dashboard — which worktree runs what |
| `observability.langwatch.localhost` | The local Grafana LGTM stack (:3000) |
| `telemetry.langwatch.localhost` | OTLP fan-out to **every** running stack |

## One-time setup

```bash
make portless-setup      # installs the portless proxy (443, trusted CA) + builds haven
```

Then, in any worktree:

```bash
pnpm dev                 # == haven up: registers hostnames, starts + supervises the stack
```

Open <https://langwatch.localhost> to see every stack across your worktrees.

## Commands

```
haven            live TUI of all stacks (a terminal version of the dashboard)
haven up         what `pnpm dev` runs — resolve slug, register, supervise
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

## Forward ideas

- **AI-gated HMR.** When an agent makes many rapid edits, constant Vite rebuilds
  are wasted work (and catch broken intermediate states). haven supervises Vite,
  so it can gate reloads — debounced, periodic, or on an explicit `haven reload` —
  instead of firing on every save.
- **Shared baseline + per-worktree overrides.** Standard services run once off
  `main`; a worktree overrides only the ones it's changing. haven already routes
  across a heterogeneous set, so the backend can become a shared `kind` cluster
  with per-worktree Helm value overlays without changing the routing model.
- **Deeper DB orchestration.** The registry already carries each stack's Redis DB;
  extend it to provision/seed per-stack Postgres/ClickHouse on demand (`haven seed`
  is the first step).
