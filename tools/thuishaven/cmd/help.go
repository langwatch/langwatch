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
    up            Resolve this worktree's slug, allocate ports, register the
                  hostnames, start + supervise the stack. (What pnpm dev runs.)
    watch         Live TUI of every running stack + service health (bare 'haven'
                  in a terminal does the same). --agent gives a plain snapshot.
    down          Tear this worktree's routes + registry entry down, and drop this
                  stack's ClickHouse + Postgres databases (pass --keep-db to keep
                  them).
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
    seed          Reseed this stack's database (fresh DB on demand).
    prune [--yes] Reclaim regenerable disk (node_modules, dist, .vite, caches)
                  from worktrees that are neither up nor dirty. Dry-run without
                  --yes. Also prunes orphaned git worktree admin entries.
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
    LANGWATCH_SEED=1             Seed the DB during up.
    HAVEN_IDLE_TTL=4h            Reap a stack whose heartbeat is older than this.
    LANGWATCH_HAVEN_CH=0         Do not manage ClickHouse (use .env CLICKHOUSE_URL).
    LANGWATCH_HAVEN_CH_STOP_IDLE=1  Daemon stops the CH container when no stacks run.
    LANGWATCH_HAVEN_CH_MEMORY_MB    CH container memory ceiling in MB (default 1536).
    HAVEN_CH_IMAGE=<image>       Override the pinned Altinity ClickHouse image.
    LANGWATCH_HAVEN_PG=0         Do not manage Postgres (use .env DATABASE_URL).
    HAVEN_PG_FORMULA=postgresql@16  brew formula to start if none is running
                                 (an already-running postgresql@NN, any version,
                                 is always reused as-is instead).
    HAVEN_PG_PORT=5432           Port to expect/start Postgres on.
    LANGWATCH_HAVEN_REDIS=0      Do not manage Redis (use .env REDIS_URL).
    HAVEN_REDIS_FORMULA=redis    brew formula to start if none is running.
    HAVEN_REDIS_PORT=6379        Port to expect/start Redis on.
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
    HAVEN_AGENT=1                Plain, colourless, redraw-free output (also on
                                 with --agent, NO_COLOR, or a non-terminal stdout)
                                 — zero token waste when an AI agent drives haven.

EXAMPLES
    pnpm dev                     # up, through haven, in this worktree
    haven list --json            # machine-readable inventory of every stack
    haven doctor                 # is everything wired up?
    LANGWATCH_GO_WATCH=1 pnpm dev # air hot-reload for gateway + nlp
`
