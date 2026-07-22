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
# (`up`, `down`, `status`, `logs`, `db reset`, `clean`, …) works here with no
# per-command wrapper to keep in sync. See `haven help` for the set. There is
# no setup step: the first `haven up` bootstraps the machine itself.
#
#   make haven install       # go install the binary, then just run `haven ...`
#   make haven up            # start this worktree's stack (== pnpm dev:haven)
#   make haven status        # every stack + shared-server health, one shot
#   make haven               # build ./bin/haven (no subcommand)

.PHONY: haven observability observability-connect observability-logs \
        observability-status observability-down

HAVEN_PKG = ./cmd/haven
HAVEN = $$(command -v haven || echo "go run $(HAVEN_PKG)")

# `make haven <subcommand>` — forward the rest of the command line to the haven
# CLI (same MAKECMDGOALS trick as `make quickstart` / `make worktree`). The extra
# words are neutralised as no-op goals so make doesn't try to build them itself.
#
# EXCEPT words that are already real targets with a recipe (`install`, `down`):
# eval-ing `install:;@:` here would give `install` a SECOND recipe, which makes
# `make` warn ("overriding commands for target 'install'"). Those two are
# instead guarded at their own recipe in the Makefile — no-op when `haven` is the
# first goal — so `make haven install` runs the go-install below (not pnpm
# install / compose down) with no redefinition and no warning.
HAVEN_REAL_TARGETS := install down
ifeq (haven,$(firstword $(MAKECMDGOALS)))
  HAVEN_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  HAVEN_NOOP_ARGS := $(filter-out $(HAVEN_REAL_TARGETS),$(HAVEN_ARGS))
  ifneq ($(HAVEN_NOOP_ARGS),)
    $(eval $(HAVEN_NOOP_ARGS):;@:)
  endif
endif

# `make haven`         -> build ./bin/haven
# `make haven install` -> go install so plain `haven ...` works everywhere after
# `make haven <sub>`   -> run the haven CLI with <sub> (up, down, status, logs, …)
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
# their own well-known targets (docs + muscle memory); underneath, the stack is
# managed automatically by `haven up` (LANGWATCH_HAVEN_OBS=0 opts out) and
# bounced with `haven restart obs`. See
# dev/docs/best_practices/local-observability.md.

# (Re)start the stack fresh (starts colima if needed). Telemetry resets — the
# stack keeps no volume.
observability:
	@$(HAVEN) restart obs

# Mint a Grafana service-account token and configure the gcx CLI with it so
# an agent can query the stack. Idempotent. (Not a haven subcommand — a script.)
observability-connect:
	@bash scripts/observability/connect.sh

# Tail the stack logs (same tap as every service: haven logs).
observability-logs:
	@$(HAVEN) logs obs -f

# Show the stack status (part of the one status report).
observability-status:
	@$(HAVEN) status

# The obs-only stop went with ADR-064's surface cut: the stack is managed
# automatically, LANGWATCH_HAVEN_OBS=0 keeps the next up from starting it, and
# `haven down --all` stops everything haven runs.
observability-down:
	@echo "removed — LANGWATCH_HAVEN_OBS=0 stops the next up from starting it; haven down --all stops everything" && exit 1
