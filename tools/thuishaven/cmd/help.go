package cmd

// helpText is example-first and exhaustive: haven is driven by AI agents as
// much as by people, so `haven help` is the single source of truth for what
// the tool can do. The COMMANDS section is generated from the command table —
// a command cannot exist without being documented, and every flag shown is a
// flag the parser actually accepts. Keep the prose copy-pasteable.
var helpText = `thuishaven (haven) — LangWatch local-dev orchestrator, your apps' home port.

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

The app and its API share ONE origin: open app.<slug>.langwatch.localhost for the
UI and hit app.<slug>.langwatch.localhost/api for the API — one URL, not two.

Shared, machine-wide (one daemon, all worktrees):

    langwatch.localhost                dashboard — which worktree runs what
    observability.langwatch.localhost  the local Grafana LGTM stack
    telemetry.langwatch.localhost      OTLP fan-out to every running stack

.localhost resolves to 127.0.0.1 natively (no /etc/hosts, no DNS, no sudo).

Bare "haven" opens the interactive hub: every stack with health, branch, RAM
footprint, and actions on the selected one (git view, down, destroy). Agents
and pipes get the plain stack list instead.

One name per command, one meaning per flag — there are no aliases.

USAGE
    haven <command> [flags]

COMMANDS
` + commandsHelp() + `
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
    HAVEN_PRUNE_STALE_DAYS=5     Idle age at which "haven prune" pre-ticks a
                                 worktree for deletion (--stale-days N overrides).
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
    haven up                     # bring this worktree's stack up
    haven pr 4913                # try PR #4913 locally in a fresh worktree
    haven                        # the hub: every stack + actions (git/down/destroy)
    haven git                    # git TUI for this worktree (haven git <slug> for another)
    haven db reset --demo        # fresh databases, seeded past onboarding with sample data
    haven status                 # every stack + shared-server health, one shot
    haven status --json          # the same, machine-readable
    haven up --watch             # air hot-reload for gateway + nlp
    haven up --detach            # background the stack; haven logs -f to follow
    haven restart nlp            # bounce one Go service without hot reload
    haven down                   # stop the stack, keep the databases
    haven down --all             # stop everything haven runs on this machine
    haven switch otel            # print the otel-* worktree's dir (cd via shell-init)
`
