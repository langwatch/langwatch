package cmd

import (
	"fmt"
	"strings"
)

// Help is layered, and the layering is the point. `haven --help` is what you
// read when you have forgotten a command's NAME, so it lists names and nothing
// else — every flag on every command, plus thirty environment variables, buries
// exactly the line you came for. The detail is not deleted, it is one command
// away: `haven help <command>` for flags, `haven help env` for the knobs,
// `haven help hosts` for the hostname scheme.
//
// The COMMANDS section is generated from the command table, so a command cannot
// exist without being documented and every flag shown is one the parser
// actually accepts.

var helpText = `thuishaven (haven) — LangWatch local-dev orchestrator, your apps' home port.

Every worktree gets its own stack, reachable by hostname rather than by port:
app|gateway|nlp.<slug>.langwatch.localhost, where <slug> is the worktree's own
directory name. Bare "haven" opens the hub — every stack, with actions.

USAGE
    haven <command> [flags]

COMMANDS
` + commandsHelp() + `
EXAMPLES
    haven up                     # stack up in the background + attached log view
    haven up +langy              # add a service here, now and from now on
    haven                        # the hub: the whole machine + actions (git/cleanup/down/destroy)
    haven status                 # every stack + shared-server health, one shot
    haven logs nlp -t            # tail one service live
    haven db seed demo           # reseed in place, dropping nothing
    haven pr 4913                # try PR #4913 locally in a fresh worktree
    haven down                   # stop the stack, keep the databases

MORE
    haven help <command>         # what it does, and every flag it takes
    haven help env               # environment variables, and where they resolve from
    haven help hosts             # the hostname scheme and the shared machine-wide URLs
`

var hostsHelpText = `Hostnames — no ports to juggle.

Each worktree's slug is its own directory name, normalized (e.g. a checkout at
.../worktrees/portless is the "portless" stack). Its services are reachable by
hostname through the portless proxy:

    app.portless.langwatch.localhost         App — the UI, and its API at /api
    gateway.portless.langwatch.localhost     AI Gateway (Go)
    nlp.portless.langwatch.localhost         NLP engine (Go)
    clickhouse.portless.langwatch.localhost  ClickHouse (this stack's own DB, HTTP)

The app and its API share ONE origin: open app.<slug>.langwatch.localhost for the
UI and hit app.<slug>.langwatch.localhost/api for the API — one URL, not two.

Postgres has no routed hostname: unlike ClickHouse (HTTP), it speaks its own
wire protocol, which the HTTP proxy can't carry — "haven db url postgres" (or
DATABASE_URL in .env.portless) is the real, loopback connection string.

Shared, machine-wide (one daemon, all worktrees):

    langwatch.localhost                dashboard — which worktree runs what
    observability.langwatch.localhost  the local Grafana LGTM stack
    telemetry.langwatch.localhost      OTLP fan-out to every running stack

.localhost resolves to 127.0.0.1 natively (no /etc/hosts, no DNS, no sudo).
`

var envHelpText = `Environment variables.

    Most of the knobs below also resolve from platform/app/.env (then
    .env.portless), so a lasting preference like "this machine runs native
    ClickHouse, never provision one" lives next to the URL it belongs with and
    travels into every new worktree. An exported variable still wins, for
    overriding a single run.

    These describe ONE run rather than one machine, so they are read from the
    process environment only: LANGWATCH_SLUG, HAVEN_BASELINE, LANGWATCH_SEED,
    HAVEN_SEED_TRACES, HAVEN_STUB, HAVEN_AGENT, NO_COLOR, FORCE_COLOR,
    HAVEN_TRUSTED_REPO_ROOT, HAVEN_UNTRUSTED_CHECKOUT. Every worktree shares one
    .env, so pinning a slug or a baseline marker there would apply it to all of
    them, and a seed flag would re-seed on every up.

    The last two are set by haven for its own children and are deliberately NOT
    read from .env: they carry a trust decision into a process whose cwd is an
    unreviewed PR checkout, and that checkout has a .env of its own.
    HAVEN_TRUSTED_REPO_ROOT names the checkout haven reads its own source from
    when it re-invokes itself; HAVEN_UNTRUSTED_CHECKOUT=1 tells up to install
    without lifecycle scripts.

  Identity and routing
    LANGWATCH_SLUG=<slug>        Pin this worktree's slug (else the normalized
                                 worktree directory name, cached).
    LANGWATCH_LOCAL_TLD=test     Use a different TLD (default: localhost).
    HAVEN_BASELINE=1             Mark this stack as the shared default others fall
                                 back to for services they don't run themselves.
    PORTLESS=0                   Bypass portless entirely (legacy PORT scheme).
    HAVEN_AGENT=1                Plain, colorless, redraw-free output (also on
                                 with --agent, NO_COLOR, or a non-terminal stdout)
                                 — zero token waste when an AI agent drives haven.

  Machine load: slots, pressure and reaping
    HAVEN_TYPECHECK_SLOTS=N      Cap concurrent "haven typecheck" runs (default:
                                 one per ~4 GiB RAM, capped at CPU count).
    HAVEN_TYPECHECK_MAX_RSS_MB   Kill a typecheck run over this RSS (default 6144
                                 = 6 GiB) or over 10 minutes wall-clock — a
                                 runaway tsgo shouldn't sit on a slot forever.
    CHECK_SLOTS=N                Caps concurrent whole-repo checks ("pnpm
                                 typecheck", "pnpm lint") machine wide (0
                                 disables). With haven installed those runs are
                                 delegated to "haven slot run", which gates on
                                 the same flock semaphore "haven typecheck"
                                 holds — one counter for everything that
                                 saturates the cores. Both set CHECK_SLOTS=0
                                 for the run they spawn, so a run is never
                                 counted twice and cannot queue behind itself.
                                 CHECK_QUEUE_IMPL=js forces the JavaScript
                                 queue in dev/scripts/check-queue.mjs.
    HAVEN_SLOT_HELD=1            Set by "haven run" inside the command it spawns:
                                 this run is already admitted, do not admit again.
    HAVEN_IDLE_TTL=4h            Reap a stack whose heartbeat is older than this.
    HAVEN_DB_TTL=336h            Background-prune databases whose worktree has not
                                 been up for this long (default 14 days; 0 disables).
                                 Only databases haven itself created are considered,
                                 and lw_main is always kept.
    HAVEN_PRUNE_STALE_DAYS=5     Idle age at which "haven clean" pre-ticks a
                                 worktree for deletion (--stale-days N overrides).

  Services and data
    LANGWATCH_SEED=1             Seed the DB during up.
    LANGWATCH_GO_WATCH=1         Hot-reload the Go services via air (else go run).
    HAVEN_WORKTREE_DIR=<dir>     Where haven pr creates PR worktrees (default: the
                                 sibling worktrees/ dir next to the checkout).
    LANGWATCH_LOCAL_API_KEY      Stable local dev API key haven seeds + injects
                                 (default sk-lw-local-development-key) — every
                                 worktree and agent authenticates with the same
                                 key. Same story for the rest of the seeded
                                 identity (admin login, PATs) — see
                                 platform/app/prisma/seed.ts's header comment.

  ClickHouse
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

  Postgres and Redis
    LANGWATCH_HAVEN_PG=0         Do not manage Postgres (use .env DATABASE_URL).
    HAVEN_PG_FORMULA=postgresql@16  brew formula to start if none is running
                                 (an already-running postgresql@NN, any version,
                                 is always reused as-is instead).
    HAVEN_PG_PORT=5432           Port to expect/start Postgres on.
    LANGWATCH_HAVEN_REDIS=0      Do not manage Redis (use .env REDIS_URL).
    LANGWATCH_HAVEN_REDIS_DB=N   Pin this worktree's Redis DB index (0-15). Use when a
                                 non-haven process from another worktree holds a DB the
                                 allocator cannot see, to avoid sharing its job queue.
    HAVEN_REDIS_FORMULA=redis    brew formula to start if none is running.
    HAVEN_REDIS_PORT=6379        Port to expect/start Redis on.
    HAVEN_REDIS_MAXMEMORY_MB=512 maxmemory ceiling applied to the managed Redis
                                 (writes fail loudly at the cap instead of the
                                 machine paging; 0 disables the cap).

  Containers, langy and observability
    HAVEN_COLIMA_PROFILE=name    colima profile ClickHouse + observability run on
                                 (default: default). A profile haven creates is
                                 capped; one that already exists is never resized.
    LANGWATCH_HAVEN_OBS=0        Skip starting the observability stack on "up".
                                 On by default: it shares ClickHouse's colima VM,
                                 which is already paying for itself.
    HAVEN_OBS_IMAGE=<image>      Override the pinned LGTM bundle image.
    LW_OBS_GRAFANA_PORT=3000     Grafana port (also LW_OBS_OTLP_HTTP_PORT=4318,
                                 LW_OBS_OTLP_GRPC_PORT=4317).
    LANGY_UNSAFE_CONTAINER=1     Run the langyagent worker in colima with the
                                 per-worker UID sandbox off. Default (neither
                                 flag) keeps the sandbox on, mirroring production.
    LANGY_UNSAFE_HOST_ACCESS=1   Run the langyagent worker as a bare host process
                                 with no colima and no VM boundary, so it has
                                 full host access.
                                 The fast-iteration tier, and the one that lets a
                                 stack come up with no container runtime at all.
    HAVEN_LANGY_IMAGE_REGISTRY   Registry ref (e.g. ghcr.io/langwatch/langyagent)
                                 to pull a CI-published langy image for the
                                 current content hash instead of building.
`

// helpTopic resolves `haven help <topic>`: a named topic, or any command.
// It reports ok=false for a topic it does not know, so asking for one is a
// failure rather than a successful print of an apology — a script that names a
// topic which has since been renamed should learn about it from the exit code.
func helpTopic(topic string) (string, bool) {
	switch topic {
	case "":
		return helpText, true
	case "env", "environment":
		return envHelpText, true
	case "hosts", "hostnames":
		return hostsHelpText, true
	}
	if body, ok := commandHelp(topic); ok {
		return body, true
	}
	return fmt.Sprintf("haven: no help for %q.\n\nTopics: env, hosts\nCommands: %s\n",
		topic, strings.Join(commandNames(), ", ")), false
}
