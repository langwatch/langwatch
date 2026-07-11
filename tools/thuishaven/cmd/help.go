package cmd

// helpText is intentionally exhaustive and example-first: haven is meant to be
// driven by AI agents as much as by people, so `haven help` is the single source
// of truth for what the tool can do. Keep it copy-pasteable.
const helpText = `thuishaven (haven) — LangWatch local-dev orchestrator, your apps' home port.

Every worktree gets a random slug (e.g. happy-tiger). Its services are reachable
by hostname through the portless proxy — no ports to juggle, no collisions:

    app.happy-tiger.langwatch.localhost      Vite frontend
    api.happy-tiger.langwatch.localhost      Hono API
    gateway.happy-tiger.langwatch.localhost  AI Gateway (Go)
    nlp.happy-tiger.langwatch.localhost      NLP engine (Go)

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
    down          Tear this worktree's routes + registry entry down.
    seed          Reseed this stack's database (fresh DB on demand).
    list [--json] Show every running stack: slug, branch, worktree, hostnames.
    doctor        Check proxy / daemon / observability / stack health.
    daemon        Run the singleton daemon (auto-spawned by up; rarely by hand).
    version       Print the version.
    help          This text.

ENVIRONMENT
    LANGWATCH_SLUG=<slug>        Pin this worktree's slug (else derived+cached).
    LANGWATCH_LOCAL_TLD=test     Use a different TLD (default: localhost).
    LANGWATCH_GO_WATCH=1         Hot-reload the Go services via air (else go run).
    LANGWATCH_SKIP_NLP=1         Do not start the NLP engine.
    LANGWATCH_SKIP_AIGATEWAY=1   Do not start the AI Gateway.
    START_WORKERS=false          Do not start background workers.
    LANGWATCH_SEED=1             Seed the DB during up.
    HAVEN_IDLE_TTL=4h            Reap a stack whose heartbeat is older than this.
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
