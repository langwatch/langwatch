package cmd

// helpText is intentionally exhaustive and example-first: haven is meant to be
// driven by AI agents as much as by people, so `haven help` is the single source
// of truth for what the tool can do. Keep it copy-pasteable.
const helpText = `thuishaven (haven) — LangWatch local-dev orchestrator, your apps' home port.

Each worktree's slug is its own directory name, sanitised (e.g. a checkout at
.../worktrees/portless is the "portless" stack). Its services are reachable by
hostname through the portless proxy — predictable, no ports to juggle:

    app.portless.langwatch.localhost         App — the UI, and its API at /api
    gateway.portless.langwatch.localhost     AI Gateway (Go)
    nlp.portless.langwatch.localhost         NLP engine (Go)
    clickhouse.portless.langwatch.localhost  ClickHouse (this stack's own DB, HTTP)

Postgres has no routed hostname: unlike ClickHouse (HTTP), it speaks its own
wire protocol, which the HTTP proxy can't carry — "haven postgres url" (or
DATABASE_URL in .env.portless) is the real, loopback connection string.

Every service defaults ON — opt out per-service with LANGWATCH_SKIP_*/
LANGWATCH_HAVEN_*=0 (see ENVIRONMENT). ClickHouse, Postgres and Redis are
singletons: ONE shared server each, a database per worktree (Redis: a DB
index — see RedisDB). Only app is never optional.

The app and its API share ONE origin: open app.<slug>.langwatch.localhost for the
UI and hit app.<slug>.langwatch.localhost/api for the API — one URL, not two.

Shared, machine-wide (one daemon, all worktrees):

    langwatch.localhost                dashboard — which worktree runs what
    observability.langwatch.localhost  the local Grafana LGTM stack
    telemetry.langwatch.localhost      OTLP fan-out to every running stack

.localhost resolves to 127.0.0.1 natively (no /etc/hosts, no DNS, no sudo).

USAGE
    haven <command> [flags]

COMMANDS
    setup         One-time machine bootstrap: check portless is installed (and
                  tell you how to install it if not), start the proxy, trust its
                  CA. Idempotent — safe to re-run. (Run it via make haven setup.)
    up            Resolve this worktree's slug, allocate ports, register the
                  hostnames, start + supervise the stack.
                  Refuses when this worktree's stack is already running. Flags:
                  -w/--watch (air hot-reload for the Go services — TypeScript
                  already hot-reloads via Vite), -f/--force (tear the running
                  stack down first and take its place), -d/--detach (run in the
                  background, logs to a file — follow with "haven logs -f",
                  stop with "haven down"). Foreground mode uses a compact live
                  TUI with the stack and recent output pinned at the top.
    restart [svc] Bounce one supervised service (app, api, gateway, nlp,
                  langyagent, workers) — or all of them with no argument —
                  without tearing the stack down. Kills the service's process
                  group; the supervisor restarts it in ~1s. The go-to for
                  services without hot reloading. Alias: rs.
    logs [-f]     Print (or follow, with -f/--follow) the log file of a stack
                  started with "haven up -d".
    switch [name] Print a worktree's directory by stack slug / worktree name
                  (prefix and substring matches work). With no name, list the
                  switchable worktrees. Add eval "$(haven shell-init)" to your
                  ~/.zshrc to make "haven switch <name>" actually cd your shell,
                  with tab-completion of the names. Alias: sw.
    shell-init    Emit the shell function + completion that turns "haven
                  switch" into a real cd (eval it from your shell rc).
    pr <ref>      Try a GitHub PR locally in seconds: clone it into a worktree,
                  install deps, and bring its stack up on a hostname. <ref> is a
                  PR number or URL (works for fork PRs too). A reused worktree is
                  fetched + reset to the PR's current head, so you always try the
                  latest push — any uncommitted edits there are autostashed first
                  (restore with the 'git stash apply <sha>' it prints) so nothing
                  is lost. Flags: --dry-run (resolve + print the plan, create
                  nothing), --no-install, --force (a non-open PR), --trusted (run
                  install lifecycle scripts for a fork — see below; --allow-scripts
                  is an alias), --discard-local-changes (overwrite those edits
                  instead of stashing them). Shares the
                  managed Postgres/ClickHouse/Redis for now — per-PR isolation is
                  the follow-up in specs/setup/haven-try-pr-plan.md.
                  TRUST: a fork PR's install runs with --ignore-scripts by default
                  (this repo has a postinstall a fork could weaponise); --trusted
                  (or --allow-scripts) opts back in. Either way 'haven up' runs the
                  PR's own app code, so only try PRs you'd be willing to run locally.
    hub           Interactive TUI of every stack (bare 'haven' in a terminal
                  opens it): health, branch, RAM footprint, and actions on the
                  selected stack — enter/g opens its git view, d shuts it down
                  (databases kept), x destroys the worktree entirely (stack
                  stopped, databases dropped, directory deleted — confirmed by
                  typing the stack's name; the primary checkout and the worktree
                  you run haven from are never destroyable). Agents get the
                  plain list. Aliases: ps, active.
    watch         Passive live view of every running stack + service health
                  (no actions). --agent gives a plain snapshot.
    down          Stop this worktree's stack from anywhere: terminate a live
                  launcher, remove the routes + registry entry. Databases are
                  KEPT — pass --drop-db for a fresh DB on the next up. Databases
                  idle past HAVEN_DB_TTL (default 14 days) are pruned in the
                  background by the daemon.
    clickhouse    Manage the shared ClickHouse (haven runs one Altinity container
                  on colima, one database per slug). Subcommands: status | up |
                  url | stop | drop [--all]. "haven clickhouse url" prints this
                  stack's CLICKHOUSE_URL; "drop" gives you a fresh, correctly-
                  counted DB. Alias: ch.
    postgres      Manage the shared Postgres (haven starts it via brew services,
                  or reuses one already running — never fights an existing
                  instance for the port). Subcommands: status | up | url | drop
                  [--all]. Same per-slug-database story as clickhouse. Alias: pg.
    observability Manage the shared LGTM stack (OTLP collector -> Loki + Tempo +
                  Prometheus, with Grafana over all three) that every worktree's
                  logs, traces and metrics land in. Subcommands: status | up |
                  down. Runs as one resource-capped container on the same colima
                  VM as ClickHouse. Once it is up, every stack you start exports
                  to it automatically, tagged langwatch.worktree=<slug>. Alias: obs.
    seed          Reseed this stack's database (fresh DB on demand). Refuses
                  when the worktree's effective DATABASE_URL/CLICKHOUSE_URL is
                  not local dev (non-loopback host, wrong user, or a
                  production-looking name). --preset demo seeds the project as
                  already past onboarding and ingests deterministic sample
                  traces through the running stack's collector, so the UI opens
                  on real-looking data (the stack must be up for the traces).
                  Model providers are seeded from the environment by default:
                  every provider whose API-key variable is set (process env,
                  langwatch/.env, or the repo-root .env) gets an enabled
                  org-scoped credential — disable with --skip-model-providers
                  (HAVEN_SEED_MODEL_PROVIDERS=0). More à-la-carte extras:
                  --traces (ingest the sample traces without the full demo
                  preset; HAVEN_SEED_TRACES=1), --first-message /
                  --no-first-message (force the project's "has received its
                  first trace" onboarding flag; HAVEN_SEED_FIRST_MESSAGE=1|0).
                  The dev feature set (Langy, AI governance, the gateway menu,
                  event-sourced analytics) is enabled by default on a managed
                  database — disable with --skip-feature-flags
                  (HAVEN_SEED_FEATURE_FLAGS=0).
    git [target]  Open the embedded git TUI (moron) for a worktree: no target
                  is this worktree; a stack slug, worktree name, or directory
                  opens that one — inspect branches, diffs, and worktrees
                  without cd-ing or checking anything out. --list prints a
                  plain per-worktree overview (branch, dirty, up) instead of
                  the TUI; agents always get that (--json for JSON).
                  Alias: moron.
    prune [--yes] Reclaim regenerable disk (node_modules, dist, .vite, caches)
                  from worktrees that are neither up nor dirty, and drop those
                  worktrees' ClickHouse + Postgres databases (lingering
                  connections are terminated; the standing lw_main database is
                  always kept). Dry-run without --yes. Also prunes orphaned git
                  worktree admin entries.
    cleanup --force  Reap orphaned local dev runtimes (tsgo, node, pnpm, uv,
                  Python, and OpenCode) belonging to this worktree. Refuses
                  without --force.
    upgrade       Reinstall the haven binary from this checkout with go install.
                  Restart an active launcher after upgrading.
    typecheck     Run "pnpm typecheck" under a machine-wide slot so parallel tsgo
                  runs across worktrees don't exhaust RAM (args forwarded).
    hmr on|off    AI-gated HMR: "on [--ttl 30s]" defers Vite reloads while an
                  agent edits (a human's browser isn't thrashed); "off" resumes.
    list [--json] Show every running stack: slug, branch, worktree, hostnames.
    doctor        Check proxy / daemon / observability / stack health.
    daemon        Run the singleton daemon (auto-spawned by up; rarely by hand).
    version       Print the version.
    help          This text.

ENVIRONMENT
    LANGWATCH_SLUG=<slug>        Pin this worktree's slug (else the sanitised
                                 worktree directory name, cached).
    LANGWATCH_LOCAL_TLD=test     Use a different TLD (default: localhost).
    LANGWATCH_GO_WATCH=1         Hot-reload the Go services via air (else go run).
    LANGWATCH_SKIP_NLP=1         Do not start the NLP engine.
    LANGWATCH_SKIP_AIGATEWAY=1   Do not start the AI Gateway (its hostname then
                                 resolves to the baseline stack, if one is up).
    HAVEN_BASELINE=1             Mark this stack as the shared default others fall
                                 back to for services they don't run themselves.
    HAVEN_TYPECHECK_SLOTS=N      Cap concurrent "haven typecheck" runs (default:
                                 one per ~4 GiB RAM, capped at CPU count).
    HAVEN_TYPECHECK_MAX_RSS_MB   Kill a typecheck run over this RSS (default 6144
                                 = 6 GiB) or over 10 minutes wall-clock — a
                                 runaway tsgo shouldn't sit on a slot forever.
    START_WORKERS=false          Do not start background workers.
    WORKERS_IN_PROCESS=1         Host the worker stack inside the app process
                                 instead of a separate "workers" lane — one Node
                                 process, less RAM (dev-only; what pnpm
                                 dev:single:haven sets).
    LANGWATCH_SEED=1             Seed the DB during up.
    HAVEN_IDLE_TTL=4h            Reap a stack whose heartbeat is older than this.
    HAVEN_DB_TTL=336h            Background-prune databases whose worktree has not
                                 been up for this long (default 14 days; 0 disables).
                                 Only databases haven itself created are considered,
                                 and lw_main is always kept.
    HAVEN_WORKTREE_DIR=<dir>     Where haven pr creates PR worktrees (default: the
                                 sibling worktrees/ dir next to the checkout).
    LANGWATCH_HAVEN_CH=0         Do not manage ClickHouse (use .env CLICKHOUSE_URL).
    LANGWATCH_HAVEN_CH_STOP_IDLE=1  Daemon stops the CH container when no stacks run.
    LANGWATCH_HAVEN_CH_MEMORY_MB    CH container memory ceiling in MB (default 1536).
    HAVEN_CH_IMAGE=<image>       Override the pinned Altinity ClickHouse image.
    HAVEN_CLICKHOUSE_FULL_LOGS=1 Keep ClickHouse's stock logging. By default
                                 haven disables the high-volume system logs
                                 (text_log, trace_log, the metric logs), caps
                                 the rest, and quiets the server log to
                                 warnings with a small bounded rotation.
    HAVEN_CLICKHOUSE_LOG_TTL_DAYS=7  How long the kept system logs live.
    LANGWATCH_HAVEN_PG=0         Do not manage Postgres (use .env DATABASE_URL).
    HAVEN_PG_FORMULA=postgresql@16  brew formula to start if none is running
                                 (an already-running postgresql@NN, any version,
                                 is always reused as-is instead).
    HAVEN_PG_PORT=5432           Port to expect/start Postgres on.
    LANGWATCH_HAVEN_REDIS=0      Do not manage Redis (use .env REDIS_URL).
    HAVEN_REDIS_FORMULA=redis    brew formula to start if none is running.
    HAVEN_REDIS_PORT=6379        Port to expect/start Redis on.
    HAVEN_REDIS_MAXMEMORY_MB=512 maxmemory ceiling applied to the managed Redis
                                 (writes fail loudly at the cap instead of the
                                 machine paging; 0 disables the cap).
    LANGWATCH_LOCAL_API_KEY      Stable local dev API key haven seeds + injects
                                 (default sk-lw-local-development-key) — every
                                 worktree and agent authenticates with the same
                                 key. Same story for the rest of the seeded
                                 identity (admin login, PATs) — see
                                 langwatch/prisma/seed.ts's header comment.
    LANGWATCH_HAVEN_OBS=0        Skip starting the observability stack on "up".
                                 On by default: it shares ClickHouse's colima VM,
                                 which is already paying for itself.
    HAVEN_COLIMA_PROFILE=name    colima profile ClickHouse + observability run on
                                 (default: default). A profile haven creates is
                                 capped; one that already exists is never resized.
    HAVEN_OBS_IMAGE=<image>      Override the pinned LGTM bundle image.
    LW_OBS_GRAFANA_PORT=3000     Grafana port (also LW_OBS_OTLP_HTTP_PORT=4318,
                                 LW_OBS_OTLP_GRPC_PORT=4317).
    PORTLESS=0                   Bypass portless entirely (legacy PORT scheme).
    HAVEN_AGENT=1                Plain, colorless, redraw-free output (also on
                                 with --agent, NO_COLOR, or a non-terminal stdout)
                                 — zero token waste when an AI agent drives haven.

EXAMPLES
    haven setup                  # one-time: install/verify portless, trust the CA
    haven up                     # bring this worktree's stack up
    WORKERS_IN_PROCESS=0 haven up # …with a standalone workers lane
    haven pr 4913                # try PR #4913 locally in a fresh worktree
    haven                        # the hub: every stack + actions (git/down/destroy)
    haven git                    # git TUI for this worktree (haven git <slug> for another)
    haven seed --preset demo     # reseed past onboarding, with sample traces
    haven list --json            # machine-readable inventory of every stack
    haven doctor                 # is everything wired up?
    LANGWATCH_GO_WATCH=1 haven up # air hot-reload for gateway + nlp
    haven up -w                  # same, as a flag
    haven up -d                  # background the stack; haven logs -f to follow
    haven restart nlp            # bounce one Go service without hot reload
    haven down                   # stop the stack, keep the databases
    haven down --drop-db         # stop AND get a fresh DB next up
    haven switch otel            # print the otel-* worktree's dir (cd via shell-init)
`
