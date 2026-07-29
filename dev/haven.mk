# =============================================================================
# THUISHAVEN — hostname-based local dev (ADR-048)
# =============================================================================
# Included from the repo-root Makefile (`include dev/haven.mk`, last line).
#
# `haven` (built from cmd/haven) is the orchestrator that gives every worktree's
# services stable hostnames — app|gateway|nlp.<slug>.langwatch.localhost (the API
# lives at app.<slug>.../api) — so multiple worktrees never fight over ports. It
# uses the `portless` npm proxy underneath purely as the TLS/hostname terminator;
# everything else (supervision, DBs, observability, the dashboard) is haven.
# Dashboard: https://langwatch.localhost
#
# `make haven <sub>` forwards <sub> straight to the haven CLI — so every command
# (`up`, `down`, `doctor`, `list`, `prune`, `seed`, `observability up`, …) works
# here with no per-command wrapper to keep in sync. See `haven help` for the set.
#
#   make haven setup         # one-time: install/verify portless + trust its CA
#   make haven install       # go install the binary, then just run `haven ...`
#   make haven up            # start this worktree's stack (== pnpm dev:haven)
#   make haven list          # which worktree runs what (all stacks)
#   make haven doctor        # proxy / daemon / observability health
#   make haven               # build ./bin/haven (no subcommand)

.PHONY: haven observability observability-connect observability-logs \
        observability-status observability-down

HAVEN_PKG = ./cmd/haven
HAVEN = $$(command -v haven || echo "go run $(HAVEN_PKG)")

# `make haven <subcommand>` — forward the rest of the command line to the haven
# CLI (same MAKECMDGOALS trick as `make quickstart` / `make worktree`). The extra
# words are neutralised as no-op goals so make doesn't try to build them itself;
# dev/haven.mk is included LAST in the Makefile so those no-ops win over any real
# target of the same name (e.g. `down`, `install`).
ifeq (haven,$(firstword $(MAKECMDGOALS)))
  HAVEN_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  ifneq ($(HAVEN_ARGS),)
    $(eval $(HAVEN_ARGS):;@:)
  endif
endif

# `make haven`         -> build ./bin/haven
# `make haven install` -> go install so plain `haven ...` works everywhere after
# `make haven <sub>`   -> run the haven CLI with <sub> (setup, up, down, doctor, …)
haven:
ifeq ($(strip $(HAVEN_ARGS)),)
	@go build -o bin/haven $(HAVEN_PKG) && echo "built bin/haven"
else ifeq ($(strip $(HAVEN_ARGS)),install)
	@go install $(HAVEN_PKG) && bash scripts/haven-install-path.sh
else
	@$(HAVEN) $(HAVEN_ARGS)
endif

# =============================================================================
# LOCAL OBSERVABILITY STACK (owned by haven — one capped container on colima)
# =============================================================================
# An ephemeral OTLP Collector + Loki + Tempo + Prometheus + Grafana for reading
# local logs/traces/metrics — including from an agent over the gcx CLI. Kept as
# their own well-known targets (docs + muscle memory); the lifecycle underneath
# is `haven observability up|status|down`. See
# dev/docs/best_practices/local-observability.md.

# Start the stack (starts colima if needed) and wait until Grafana is healthy.
observability:
	@$(HAVEN) observability up

# Mint a Grafana service-account token and configure the gcx CLI with it so
# an agent can query the stack. Idempotent. (Not a haven subcommand — a script.)
observability-connect:
	@bash scripts/observability/connect.sh

# Tail the stack logs. (Not a haven subcommand — plain docker.)
observability-logs:
	@docker logs -f langwatch-otel-lgtm

# Show the stack status (also covered by `make haven doctor`).
observability-status:
	@$(HAVEN) observability status

# Stop ONLY the observability stack (never the rest of the dev stack). The stack
# keeps no volume, so this discards all collected telemetry by design.
observability-down:
	@$(HAVEN) observability down
