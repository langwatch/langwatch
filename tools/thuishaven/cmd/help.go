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
    clickhouse.portless.langwatch.localhost  ClickHouse (this stack's own DB)

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
                  stack's ClickHouse database (pass --keep-db to keep it).
    clickhouse    Manage the shared native ClickHouse (haven runs one server, one
                  database per slug). Subcommands: status | up | url | stop |
                  drop [--all]. "haven clickhouse url" prints this stack's
                  CLICKHOUSE_URL; "drop" gives you a fresh, correctly-counted DB.
    seed          Reseed this stack's database (fresh DB on demand).
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
    START_WORKERS=false          Do not start background workers.
    LANGWATCH_SEED=1             Seed the DB during up.
    HAVEN_IDLE_TTL=4h            Reap a stack whose heartbeat is older than this.
    LANGWATCH_HAVEN_CH=0         Do not manage ClickHouse (use .env CLICKHOUSE_URL).
    LANGWATCH_HAVEN_CH_STOP_IDLE=1  Daemon stops the CH server when no stacks run.
    LANGWATCH_HAVEN_CH_MAX_MEMORY   CH server memory ceiling in bytes (default 4GiB).
    CLICKHOUSE_BIN=/path/clickhouse  Override the clickhouse binary location.
    LANGWATCH_LOCAL_API_KEY      Stable local dev API key haven seeds + injects
                                 (default sk-lw-local-development-key) — every
                                 worktree and agent authenticates with the same key.
    LANGWATCH_OBSERVABILITY_PORT Grafana port to route (default 3000).
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
