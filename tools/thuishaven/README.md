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

| Hostname                                | Service                                 |
| --------------------------------------- | --------------------------------------- |
| `app.<slug>.langwatch.localhost`        | App — the UI, **and its API at `/api`** |
| `api.<slug>.langwatch.localhost`        | The API, direct - additive alongside `app.<slug>.../api`, not a replacement |
| `gateway.<slug>.langwatch.localhost`    | AI Gateway (Go)                         |
| `nlp.<slug>.langwatch.localhost`        | NLP engine (Go)                         |
| `clickhouse.<slug>.langwatch.localhost` | ClickHouse — this stack's own database  |

Two more are there only when the worktree asked for them (`haven up
+design-system +mail-room`) — developer tools rather than parts of the product:

| Hostname                                   | Service                                   |
| ------------------------------------------ | ----------------------------------------- |
| `design-system.<slug>.langwatch.localhost` | The design system's Storybook             |
| `mail-room.<slug>.langwatch.localhost`     | The mail studio — every message previewed |

The design system answers to a shorter spelling too: `ds` stands in for
`design-system`. The mail studio has no alias — its hostname is
`mail-room.<slug>`, full stop.

The **app and its API share one origin** for the browser: open
`app.<slug>.langwatch.localhost` for the UI and hit
`app.<slug>.langwatch.localhost/api` for the API - Vite serves the SPA and
proxies `/api` (plus `/mcp`, `/sse`, `/oauth`, `/.well-known/*`) to the API
backend on loopback. `api.<slug>.langwatch.localhost` additionally routes
straight to that same backend, no UI dev server in front of it - a direct
route for a CLI, a script, or an agent that wants the API and nothing else.
It does not replace the app's own `/api` path; both point at the same port.

Shared, machine-wide (one daemon serves all worktrees):

| Hostname                            | What                                    |
| ----------------------------------- | --------------------------------------- |
| `langwatch.localhost`               | Dashboard — which worktree runs what    |
| `observability.langwatch.localhost` | The local Grafana LGTM stack (:3000)    |
| `telemetry.langwatch.localhost`     | OTLP fan-out to **every** running stack |

## Setup

There is none. The first `haven up` bootstraps the machine itself: installs
portless if missing, trusts its CA, starts the proxy — every step idempotent.
`make haven install` (optional) go-installs the binary so plain `haven ...`
works everywhere, and then runs `haven install`, which checks the machine for
everything else haven drives — node, pnpm, go, the brew formulae behind the
shared Postgres and Redis, a container runtime — and offers to install what is
missing. Nothing is installed without being ticked, and anything declined with
"never" is remembered for the machine (`haven install --reset-skips` undoes
that). Hostname routing is opt-in — `pnpm dev` uses the plain `PORT` scheme:

```bash
haven up                 # registers hostnames, starts + supervises the stack
haven up +langy          # …with the langy agent manager too (sticky, per worktree)
```

Every stack runs the three Node applications as three lanes — `ui`
(`@langwatch/ui`, Vite), `api` (`@langwatch/platform-api`) and `workers`
(`@langwatch/worker`) — each `pnpm --filter <package> dev` from the workspace
root. They are not selectable: a stack running two of the three would serve
pages and quietly process no jobs. `app.<slug>` is the ui lane's hostname, and
`/api` under it proxies to the api lane on loopback.

Open <https://langwatch.localhost> to see every stack across your worktrees.

## Commands

One name per command, one meaning per flag, no aliases (ADR-064). The daily
surface is six verbs; `db` and `clean` are the only destructive nouns.

```text
haven            the hub: the whole machine — stacks, worktrees, RAM by owner,
                 the daemon's reaping — with actions on the selected row
                 (agents/pipes get the plain status report)
haven up         start or reconcile this worktree's stack — in a terminal it
                 runs in the BACKGROUND under an attached log view: ←/→/tab/digits
                 switch between "all" and per-service logs, q detaches (the stack
                 keeps running; haven down stops it). +svc/-svc picks services and
                 sticks (+langy, -nlp, -gateway, +design-system, +mail-room); a fresh
                 worktree runs ui + api + workers + nlp + gateway + idp, with
                 langy and the two developer tools off. -w watches
                 the Go services via
                 air; -d detaches without the view; --rebuild forces images
haven down       stop this worktree's stack — data is always kept;
                 --all stops every stack, the shared servers, daemon, and proxy
haven restart    bounce one supervised service (or all) in place; `restart obs`
                 bounces the observability stack; `restart langy --rebuild`
                 re-images first
haven idp        run ONLY the IdP simulator — no ui, api or databases — routed
                 at idp.langwatch.localhost; --tenants <n> sizes the range
haven logs       captured service logs from any terminal, attached or detached:
                 all interleaved, `haven logs nlp` filters, -t tails,
                 --since 10m windows, --level warn filters severity,
                 --stack <slug> reads another worktree, `logs obs` streams LGTM
haven status     one-shot report: selection, per-service health, shared servers,
                 RAM footprints (--json for machines)
haven db         this stack's data: `db seed [preset]` (reseed in place, drops
                 nothing) · `db reset [preset]` (fresh database, confirmed;
                 --yes for scripts) · `db url [engine]`. Presets: demo,
                 onboarding, post-onboarding, bare
haven clean      one cleanup: worktree picker, then job-scratch picker, then safe reclaim
                 (build artifacts, orphaned processes); --yes applies only the
                 safe categories
haven pr <ref>   try a GitHub PR in a fresh worktree (--allow-closed,
                 --allow-scripts)
haven play [pr]  run a PR in a throwaway sandbox: own checkout, own
                 Postgres/ClickHouse/Redis containers, own play-<n> hostname.
                 Quitting the view DESTROYS everything it created, every time.
                 No argument opens a picker of open PRs (terminal only).
                 --seed <preset> seeds it from the same registry `db seed`
                 reads, so it can open past onboarding rather than on it:
                 demo adds the demo prompt, HTTP agent and dataset,
                 onboarding and post-onboarding move the onboarding flag,
                 bare is the identity alone
                 Trust-gated: every commit author must have write access, or a
                 two-step confirmation — y/N, then the PR number typed back
                 after it discloses that the code runs as you, from this
                 shell's environment (--allow-untrusted in agent mode)
haven git        embedded git TUI (moron) for any worktree — `haven git <slug>`
haven switch     print a worktree's dir by name; with `eval "$(haven shell-init)"`
                 it becomes a real cd, tab-completed
haven shell-init emit that shell function + completion
haven hmr        AI-gated HMR: `on [--ttl 30s]` defers Vite reloads, `off` resumes
haven slot       run any command under the machine-wide check slot:
                 `slot run [--label <l>] -- <cmd> [args…]` waits for a slot,
                 runs with stdio passed through, releases; `slot explain`
                 prints the resolved limit plus every current holder and
                 waiter (class, age, effective priority). check-queue.mjs
                 delegates every whole-repo check here when haven is
                 installed, and so do the tsc/tsgo/oxlint/oxfmt/vitest bin
                 shims and `make go-lint`. A queued run's priority ages the
                 longer it waits, so a sub-agent is never starved forever;
                 HAVEN_PRIORITY=high states a run matters, honoured once per
                 agent id every ten minutes
haven typecheck  pnpm typecheck under a machine-wide RAM slot
haven install    check this MACHINE for what haven drives but does not own —
                 portless, node, pnpm, go, the brew formulae behind the shared
                 Postgres and Redis, a container runtime, the ClickHouse
                 client, rtk — and offer to install what is missing. A terminal gets a
                 picker (space ticks, `n` is never-ask-again, ←/→ picks between
                 colima and Docker Desktop); a pipe or an agent gets the report
                 and the commands. --yes installs what haven needs without
                 asking, --list only reports, --reset-skips forgets every
                 never-ask-again. Naming one installs exactly that:
                 `haven install clickhouse-client`, `haven install runtime=docker-desktop`
haven setup      install optional integrations into this CHECKOUT (the agent
                 gate hooks) — see "Optional agent hooks" below
haven upgrade    reinstall the haven binary from this checkout
haven help       exhaustive, copy-pasteable reference
```

**Service selection.** `haven up +langy` / `haven up -nlp` — sticky per
worktree (`.haven.json`), shown by `status`, remembered across terminals and
reboots. A running stack reconciles: matching selection is a no-op, a changed
one replaces the stack in place. langy is off by default (it costs a container
image and a hard memory cap); the worktrees that need it say `+langy` once.
idp — the identity-provider simulator (`services/idpsim`: a range of OIDC +
SAML + SCIM tenants with DNS/HTTP domain verification, routed at
`idp.<slug>.langwatch.localhost`) — runs by default; a worktree that does not
want it says `haven up -idp` once. `haven idp` runs the simulator alone —
no app, API or databases — routed machine-wide at `idp.langwatch.localhost`.

**Automatic preparation.** `up` owns the whole path from a fresh machine to a
running stack: portless install (pinned to one version, `domain.PortlessVersion`
— haven installs it when it is missing, upgrades a machine that has another
version, and does nothing when the pin is already there) + CA trust (once per
machine, guarded by a marker so it never re-prompts), `pnpm install` when the lockfile
changed, database create + migrate + seed, recovery of a wedged ClickHouse
container (data kept), and content-addressed langy images — rebuilt only when
the Dockerfile or a COPY source actually changed, pulled from CI when
`HAVEN_LANGY_IMAGE_REGISTRY` is set, `--rebuild` to force. A failed migration
stops the up and names the one recovery command (`haven db reset`); nothing is
ever dropped silently.

**Logs.** The supervisor captures every service's output to per-service,
size-capped files whether the stack runs attached or detached — so `haven
logs` works from any terminal, filters by plain argument, and still reads
after a crash or a `down`. Capture is built to keep going: a line longer than
1 MiB (the api lane prints its errors as one-line JSON, so a stack dump is one
line) is split across captured lines instead of ending the read, the pipe is
drained to EOF before the child is reaped so nothing buffered is lost, and a
log file that cannot be written or rotated is retried a few seconds later
rather than dropped for the life of the process. A rotation that cannot happen
degrades to appending past the cap, never to silence.

**The hub.** Bare `haven` opens the interactive machine view. The header is
the machine's real memory picture from one process listing, every process
attributed once: each stack charged its whole process **tree** (supervised
children lead their own process groups, so a group sum sees only the ~20MB
launcher), the shared servers (ClickHouse, Postgres, Redis, the container VM),
the coding agents and dev tooling beside them, and everything that is not dev
work as its own colour in the chart — with the daemon's pressure level when it
is not green. Below it, every stack (liveness, branch, service health, RAM);
idle worktrees stay collapsed behind `t` while stacks run and show by default
otherwise. Actions run on the selected row — enter/`g` opens its git view (and
returns to the hub on quit), `o` opens the stack's app, `r` restarts it, `d`
shuts it down keeping its databases, and `x` destroys the worktree entirely:
stack stopped, ClickHouse + Postgres databases dropped, directory deleted,
confirmed by typing the name. The primary checkout and the worktree haven runs
from can never be destroyed. One-key handoffs: `c` opens the interactive
cleanup picker and returns, `w` opens the machine's web dashboard, and `m`
toggles the monitor panel — the shared servers' footprints plus the daemon's
recent reaping (stacks, test containers, governed processes, idle databases),
newest first, from the persisted event record. The web dashboard
(`langwatch.localhost`) shows the same machine: the memory chart, the stack
cards (their own services only — the shared servers are stated once), the idle
worktrees, and the reaping feed.

**Seeding.** `haven db seed` reseeds in place — an idempotent upsert that can
only add or refresh, never discard — and `haven db reset` is the destructive
sibling that starts from a fresh, migrated database. Both take a preset:
`demo` marks the project past onboarding and adds the demo prompt, HTTP agent
and dataset, `onboarding` / `post-onboarding` flip the first-trace flag, and
`bare` seeds the identity alone. Every preset is switches that
`packages/prisma-client/prisma/seed.ts` reads for itself, so none of them
needs a running stack.

`traces` and `mass` are RETIRED and refused by name. Both existed only to run
ingest scripts through the live stack's collector — `seed:sample-traces`,
`seed:realistic-platform`, `seed:mass` and the `seed:retention` pin that had to
precede them — and all four lived in the platform application, which is
deleted. Nothing that survives loads data through the collector. The ingest
machinery itself is intact and tested (`seedPreset.ingest`, `runSeedIngest`,
`ingestPlaySeed`); it is the seam those seeds return through, and every
shipped preset's list is empty until they do.

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

A sandbox's databases start empty, so the PR opens on the onboarding screen —
the wrong place to be standing if the change is about anything afterwards.
`haven play 4913 --seed demo` takes the same presets as `haven db seed` (one
registry, no play-only variants) and applies them where each belongs: the
preset's switches go to the sandbox's own seed, and any data that has to travel
through the collector is ingested once the sandbox's app answers, in a lane
beside the services. A failed ingest never takes the sandbox down — it names
the step and the command that retries it, since a PR that broke the collector
is exactly the PR you want to keep watching. No shipped preset ingests
anything today (see Seeding), so a sandbox waits for nothing and every preset
is a plain seed.

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
agent drives haven. `haven status --json` is the machine-readable inventory:
`stacks` is always a list (`[]` when nothing is registered, never `null`), each
stack carries `live` (its launcher process is running), and each service carries
`listening` (something accepts connections on the port its hostname routes to).
A listed stack is a registered stack, which is not the same as a running one.

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

**A dead stack deregisters, it never respawns.** Every 10s the daemon compares
each registered stack against its launcher process. When the launcher is gone
(an out-of-memory kill from the OS, a closed terminal, a crashed `pnpm dev`) it
removes every hostname the stack could own (the four per-worktree services, any
service the stack recorded, and the `clickhouse` + `postgres` aliases) and then
drops the registry entry. The hostname then gets portless's own "no route"
answer. Leaving the route up is the failure this closes: the kernel reissues the
loopback port to the next process that asks, and the hostname starts serving an
unrelated worktree's dev server, which answers HTML 404s to `/api/*` and reads
like an auth or routing bug rather than a dead stack. haven does not restart
what it did not start; `haven up` is the recovery, and it deregisters the dead
entry's routes before it provisions.

The resolved config — hostnames, ports, database URLs, the seeded local
identity — is never written to a file. Every process haven starts is handed it
directly in its environment, which beats anything pinned in `.env` because a
dotenv loader does not override a variable the process already has. For a
person's own shell, and for a tool haven does not spawn:

```bash
eval "$(haven env)"     # this worktree's stack, in this terminal
haven env --json        # the same set, machine-readable
haven status            # shows what the stack resolved to, no eval needed
```

Keeping it in memory is deliberate: a dotenv file was a copy of state haven
already holds, sitting in the checkout with the stack's database URLs and local
access tokens in it, going stale the moment the stack came down. `haven up`
deletes `.env.portless` and `.env.haven` if it finds either, and says so once;
both stay in `.gitignore` so a stray file can never be committed.

### Why native processes, not kind/k8s (yet)

Vite/tsx run as **native host processes** for instant HMR — running the dev
server inside a container/kind mount reintroduces the slow file-watching it
already fights. haven routes across native processes **and** containerized
backends uniformly by hostname, so a future backend swap (a shared `kind`
cluster with per-worktree Helm value overlays: standard services off `main`,
worktrees overriding select ones) is a change _behind_ haven — the routing,
registry, and dashboard stay the same.

### Two checkout layouts

haven starts whatever the checkout defines, not what this worktree happens to
be. The layout is detected once, at `up`, from the directories on disk, and
recorded on the stack, so `haven status --json` carries it and everything
downstream reads that one answer:

| Layout     | Detected by             | Node lanes                     |
| ---------- | ----------------------- | ------------------------------ |
| `modular`  | `apps/ui` + `apps/api`  | `ui` + `backend`               |
| `monolith` | `platform/app`          | `app`, one process for both    |

A checkout with neither shape is planned as modular and fails on its own lane's
error rather than on a guess.

The monolith layout is `origin/main`, and it exists here so `apidiff` and
`visualdiff` can boot their base ref as its own haven stack (`tools/havenrun`,
`specs/tooling/visualdiff-on-haven.feature`). On such a stack:

- The one Node lane is `app`: `pnpm --filter @langwatch/web run dev:app`, handed
  `PORT` as the app port haven allocated and reached at the routed `app.<slug>`
  hostname, with its API under `/api` on the same origin. `haven logs app`,
  `haven restart app` and `haven status --json`'s `lanes` all name it.
- `haven up +ui` / `+backend` are refused by name, the way `+api` already is:
  neither package exists there.
- The Go data-plane services get one process each, through `make service`. That
  checkout's mono-binary has no `combined` subcommand, so the single `go` lane a
  modular stack runs cannot exist; `service-watch` is not used either, because
  its target refuses to start without a dotenv file inside `platform/app`. Both
  wait for the health path first, since the control plane they call is the `app`
  lane.
- Migrations run `start:prepare:db` through `@langwatch/web`, which is where that
  checkout defines it. Codegen gets no job of its own: `dev:app` runs the same
  codegen on its way up, and haven says so in one line instead of paying for it
  twice.
- Two things that checkout does for itself are worth knowing. Its start script
  re-derives `BASE_HOST` and `NEXTAUTH_URL` from `PORT`, so those point at
  `http://localhost:<app port>` rather than the routed hostname - both addresses
  reach the same listener, but a browser signing in through the hostname can hit
  an origin mismatch (`PORTLESS=0` makes the two agree). And its port pre-flight
  checks `PORT + 1000` even though the API binds the port haven allocated, so a
  busy `PORT + 1000` refuses a boot that would have worked.
- The two developer-tool lanes (`design-system`, `mail-room`) have no packages
  there. They are off by default; selecting one on a monolith stack starts a lane
  that fails.

## More of what haven does

- **Managed ClickHouse.** haven runs one shared native `clickhouse-server` and
  gives every worktree its own database (`lw_<slug>`) on it — so migration counts
  are always this worktree's own. Light local config (memory cap, no S3 tiering,
  no zero-copy). The server lifecycle is automatic; `haven db url clickhouse`
  prints this stack's URL, `haven db reset` gives it a fresh database, and the
  daemon prunes databases whose worktree hasn't been up for `HAVEN_DB_TTL`
  (default 4 days). `LANGWATCH_HAVEN_CH_STOP_IDLE=1` additionally stops the
  server once no stack is running (opt-in: native-mode tests and
  `haven db url clickhouse` reach it with no stack up) — the next `up`
  restarts it over the same data in seconds.
- **The TypeScript compiler can never take the machine down.** The daemon
  watches every compiler process on the machine — `tsc` (typescript@7) and
  `tsgo` (the preview package) alike, as one class against one budget, however
  it was spawned — and reclaims runaways: a
  whole-tree run past `HAVEN_TSGO_RUN_MAX_RSS_MB` (default 12 GiB), a language
  server past `HAVEN_TSGO_LSP_MAX_RSS_MB` (default 4 GiB) or idle past
  `HAVEN_TSGO_LSP_IDLE_TTL` (default 45m), and — over
  `HAVEN_TSGO_TOTAL_BUDGET_MB` (default two thirds of RAM, never below the
  per-run ceiling) — the youngest run
  until the rest fits. The check queue also sets `GOMEMLIMIT` on the runs it
  spawns — half the machine, clamped to `[3, 6]` GiB — so the common case
  degrades to "slower" rather than expanding into whatever room the machine
  happens to have (`dev/docs/adr/100-the-typecheck-memory-ceiling.md`). On a
  machine already under memory pressure (ADR-090's levels) the queue goes
  further: the derived slot limit narrows to one, `GOMEMLIMIT` drops to its
  3 GiB floor and `GOMAXPROCS` is halved, so the check pays for the shortage
  instead of everything else swapping. `CHECK_PRESSURE=green|amber|red`
  forces the level; explicit `GOMEMLIMIT`/`GOMAXPROCS`/`CHECK_SLOTS` win. The
  same watch observes gopls, oxlint, vitest workers, node, bun and claude
  agents (never touched — observed only) and ships every class's footprint to
  the local Grafana as `haven_proc_*` metrics. See
  `dev/docs/adr/095-haven-tsgo-governor.md`.
- **Leaked test containers are reaped.** An interrupted integration-test run
  leaves its Testcontainers (a stray ClickHouse, a Redis) running in the shared
  VM forever — the library's own reaper (Ryuk) dies with the run, and reused
  containers are skipped by it entirely. The daemon removes
  Testcontainers-labelled containers: terminally stopped ones (exited or dead)
  older than `HAVEN_TESTCONTAINER_TTL` (default 10m; 0 disables the sweep),
  every other state only past the greater of that and `HAVEN_TESTCONTAINER_RUNNING_TTL`
  (default 2h) since a running (or paused, or mid-restart) container may still
  be serving a live run whatever its age. Ryuk itself is never touched, and the
  sweep never boots the VM just to clean it. See
  `specs/setup/haven-testcontainer-reaper.feature`.
- **Temporary and merged worktrees, and finished job scratch, are reclaimed
  daily.** The two places a multi-agent machine silts up unattended. Once a day
  the daemon removes every worktree classified temporary or merged (see
  `haven clean` below for both definitions) with `git worktree remove --force`
  plus a `git worktree prune`, logging one line per removal naming the reason,
  and reclaims the scratch of every **cold** agent job — terminal for more than
  48 hours, or untouched for a week — while
  keeping its `state.json` and `timeline.jsonl`. A job that finished this
  morning is never reclaimed unattended: the tail of a run is read long after
  the run itself is `done`. It drops no database on this
  path — a database is not regenerable, so only the interactive picker, which
  shows exactly which are in scope, may drop one (ADR-064) — and it never
  touches a worktree that is dirty, live, the primary checkout, or the one haven
  runs from, nor a job any live process still names. See
  `specs/setup/haven-disk-reclaim.feature`.
- **Always migrate + seed, fully static identity.** Every `up` migrates _and_
  seeds idempotently. Nothing about the local dev identity is ever randomly
  generated — the same admin login, org/team/project/user IDs, and API
  tokens exist on every worktree and every machine. See the doc comment at
  the top of `packages/prisma-client/prisma/seed.ts` for the exact values (admin email +
  password, ingestion key `sk-lw-local-development-key` (override
  `LANGWATCH_LOCAL_API_KEY`), a private full-access personal access token,
  and a public ingestion-only token).
- **Shared-baseline fallback.** Every stack defines all hostnames; a service a
  worktree doesn't run itself (`haven up -gateway` / `-nlp`)
  resolves to a shared baseline stack (`HAVEN_BASELINE=1`, off `main`) instead of
  dead-ending. ClickHouse embodies this: one server, `clickhouse.<slug>` always
  resolves, only the database is per-worktree.
- **Developer tools are lanes, not products.** The design system's Storybook and
  the mail studio stay in their own packages (`@langwatch/design-system`,
  `@langwatch/mail`); haven only offers to run them, off by default, the way it
  offers langy. Nothing in the application degrades without either, and neither
  is ever counted among the three Node lanes. Selecting the Storybook also tells
  the ui lane which port it is on (`LANGWATCH_STORYBOOK_PORT`), so opening
  `/design-system` in the app frames the Storybook the stack is already running
  instead of starting a second one.
- **Sandboxed Langy worker (by default).** The langyagent worker runs the Langy
  agent, so haven isolates it like production rather than letting a test model run
  as your own user. Two env flags pick one of three tiers:
  - _neither_ (default): the worker runs in the shared colima VM with the
    per-worker UID sandbox on (production-like); nothing it does can touch your
    real filesystem. haven builds `langyagent:dev` into colima on first `up`
    (minutes once; the image tag is content-addressed, so it rebuilds by itself
    when its build inputs change — `haven up --rebuild` or
    `haven restart langy --rebuild` forces it).
  - `LANGY_UNSAFE_CONTAINER=1`: still in the colima VM (host still isolated), but
    the per-worker UID sandbox is off — simpler/faster when iterating.
  - `LANGY_UNSAFE_HOST_ACCESS=1`: runs the worker as a bare host process, no VM,
    full host filesystem access — the least safe, for when it genuinely must reach
    host paths.

  The tier is resolved once, before the stack is built, from those flags **and the
  machine**: on a development stack with no container runtime reachable (neither
  `colima` nor `docker` on PATH) haven resolves the host tier by itself rather than
  running no manager at all, and prints `no container runtime; running langyagent on
the host because this is a development stack; set LANGY_UNSAFE_HOST_ACCESS=0 to
refuse`. That one line is the whole point: a quieter isolation posture than the one
  you believe you have is never inferred in silence. `LANGY_UNSAFE_HOST_ACCESS=0`
  refuses it, and a stack that is not a development one (`NODE_ENV` / `ENVIRONMENT`
  naming anything outside `local`/`dev`/`development`/`test`) still fails closed:
  langy is deselected with the opt-in named.

  In the container tiers the worker reaches the control plane + gateway back on the
  host via `host.docker.internal` (haven injects `LANGY_WORKER_CALLBACK_URL` /
  `LANGY_WORKER_GATEWAY_URL`), and the host reaches the manager over a published
  loopback port. Production is never any of these — it always runs sandboxed under
  gVisor.

- **`haven clean`.** One cleanup command, and **two pickers in turn** — worktrees
  first, then agent job scratch. Never one merged list: the two kinds have
  different guards and different consequences, and a single list invites ticking
  one while reading the other. Every header, progress line and summary counts
  the kind it is actually acting on, and every list is sorted **newest first**,
  so recent work sits at the top of the screen where a mistaken tick is seen
  rather than scrolled past.

  The worktree picker scans every
  worktree at once (git + database facts on a fast queue, disk size via `du` on
  a slow one), pre-ticks everything idle 5+ days (`--stale-days N`), lets you
  sort and tick, then removes exactly those (stack stopped, databases dropped,
  directory removed — the primary checkout, the current worktree, and `lw_main`
  are never touched), and finishes by reclaiming the safe categories:
  regenerable build artifacts of idle worktrees and orphaned dev runtimes.
  Two more categories are pre-ticked on their class rather than their age, with
  the reason in the row:
  - **temporary** worktrees — a detached checkout under `.apidiff/` or
    `.claude/worktrees/`, a `visual-*` / `apidiff-*` directory under a
    `worktrees` parent, anything under `.claude/jobs/`, or any worktree on a
    `worktree-agent-` / `agent/` branch — once nothing has been written in the
    directory itself for a day. That clock is the directory's own mtime, not its
    HEAD's committer date: a diff drive checks out whatever ref it is comparing,
    so a comparison made five minutes ago against a year-old tag would otherwise
    read as a year idle.
  - **merged** worktrees, whose branch is already an ancestor of `origin/main`
    (`git merge-base --is-ancestor`), at any age.

  The second picker lists the reclaimable **agent jobs** under `~/.claude/jobs`
  (`HAVEN_JOBS_ROOT`) with their size, name, state and age. Reclaiming a job
  deletes its scratch — `tmp/`, worktree copies, logs — and keeps `state.json`
  and `timeline.jsonl`, so what the job was and what it did survive. A job is
  reclaimable once its state is terminal (`done`, `stopped`, `failed`) or its
  directory has gone both unwritten and unread for seven days; a job any live
  process still names, and the job haven itself was launched from
  (`HAVEN_JOB_DIR` / `CLAUDE_JOB_DIR`), are never touched.

  Only a **cold** job is pre-ticked: terminal for more than 48 hours, or
  untouched for a week. A job that finished more recently is listed held back
  and cannot be ticked at all — `--include-recent` is the one thing that reaches
  it, and no unattended path passes it.

  Before anything goes, each picker shows a **one-screen confirmation**: the
  kind, the count, the total size, and the five newest ticked rows with their
  age, size and reason — the rows a mistake costs most, named where they are
  read — behind the typed `delete`.

  `--yes` skips both pickers and applies **exactly the pre-tick defaults**:
  temporary and merged worktrees, cold job scratch, build artifacts and orphan
  processes. Everything it removes is regenerable — a temporary worktree is
  scratch a tool makes on demand, a merged one's commits are already on main,
  and a job's scratch comes back by re-running the job. Databases are still
  never dropped unattended, and a worktree with uncommitted changes is never a
  candidate whatever its age. Agents (and any non-TTY) get the read-only report,
  which names both new categories, and delete nothing.

  **Output discipline.** Exactly one thing owns stdout per run. In a terminal
  the picker owns it and the structured log goes to `clean.log` under the haven
  home; under `--agent`, `--yes`, or a piped stdout there is no spinner at all —
  one plain line per item, then one summary counting each kind separately
  ("reclaimed 158 job scratch dirs, 2.1 GB; 3 worktrees, 500 MB"). A zap record
  never lands on the stream a progress render or a parsed line is using.

- **`haven typecheck`.** Run `pnpm typecheck` under a machine-wide slot so parallel
  typechecks across worktrees don't exhaust RAM (bounded by memory / CPU). It shares the `checks` semaphore with `haven slot run` and
  hook-launched commands. Plain repository scripts run directly.
- **AI-gated HMR.** `haven hmr on [--ttl 30s] | off` defers Vite reloads while an
  agent edits, then fires one catch-up reload — a human's browser isn't thrashed
  through broken intermediate states. Opt-in and always time-bounded.

## Optional agent hooks

Run either setup command in the worktree where you want Haven to admit heavy
agent commands, or name both features in one invocation:

```sh
haven setup gate-hook codex-gate-hook
```

`gate-hook` merges the Claude hook into `.claude/settings.local.json`;
`codex-gate-hook` merges the Codex hook into `.codex/hooks.json`. Both files stay
gitignored and local to that worktree. Existing hooks survive, and repeating
setup does not add another Haven hook. `haven up` installs neither integration.

For Codex, open `/hooks` in a trusted project to review and trust the installed
hook. Hooks are enabled by default; setup does not change an explicit disabled
feature setting. The command uses the same Haven admission and execution path
as Claude, with Codex-compatible hook output and no added compiler memory caps.
Command rewriting applies only in automatically approving permission modes;
default, plan, or missing modes keep the normal permission flow unchanged.
See [the official Codex hook documentation](https://learn.chatgpt.com/docs/hooks).

## Forward ideas

- **Per-worktree Postgres.** Today Postgres is the shared singleton and ClickHouse
  is per-slug; extending per-worktree isolation to PG would let "a new DB is always
  migrated + seeded" cover Postgres too.
- **Shared `kind` cluster.** The baseline fallback already routes across a
  heterogeneous set, so the backend can become a shared `kind` cluster with
  per-worktree Helm value overlays _behind_ haven — the routing, registry, and
  dashboard stay the same.
