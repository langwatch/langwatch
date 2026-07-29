# =============================================================================
# BOXD WORKFLOWS
# =============================================================================
# Targets here orchestrate multi-step flows. For single-command operations,
# use the `boxd` CLI directly (`boxd list`, `boxd destroy NAME`, `boxd info`).
#
# Surface:
#   make boxd-golden                       # build the canonical base VM
#   make boxd-golden-reset                 # destroy + rebuild golden (needs BOXD_FORK_YES=1)
#   make boxd-fork-pr PR=1234              # fork golden for an existing PR
#   make boxd-fork-branch BRANCH=feat/foo  # fork golden for a branch
#   make boxd-fork-issue ISSUE=123         # fork + worktree branch + tmux+claude in VM
#   make boxd-connect-pr PR=1234           # SSH + tmux attach to the matching VM
#   make boxd-connect-branch BRANCH=feat/foo
#   make boxd-connect-issue ISSUE=123
#   make boxd-preview BRANCH=feat/foo      # ephemeral PR-preview VM (fork langwatch-golden-v2)
#   make boxd-preview-down BRANCH=feat/foo # destroy the preview VM
#   make boxd-preview-status BRANCH=feat/foo # print VM status + stack state
#
# Naming: forks live at langwatch-<branch-slug> or langwatch-issue<N>.
# tmux session inside the VM matches as claude-<branch-slug> / claude-issue<N>.
# Preview VMs live at preview-<branch-slug> (no namespace prefix — team shared golden).
#
# See dev/docs/boxd-makefile.md for the full reference + threat model.

.PHONY: boxd-help boxd-golden boxd-golden-reset \
        boxd-fork-pr boxd-fork-branch boxd-fork-issue \
        boxd-connect-pr boxd-connect-branch boxd-connect-issue \
        boxd-preview boxd-preview-down boxd-preview-status \
        seed-golden _boxd-fork-impl _boxd-require

BOXD_FORK_LIB := scripts/boxd-fork.sh
# Recipes call bash explicitly so the bash-only sourcing helpers in
# scripts/boxd-fork.sh (e.g. `[[ … ]]`) work even when Make's default SHELL
# is /bin/sh. The prefix must be concatenated with the function call inside
# the same `-c` argument; passing them as separate args is a common bash
# pitfall (the second arg becomes $0, never executes).
BOXD_RUN_PREFIX := . $(BOXD_FORK_LIB) &&

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

boxd-help:
	@echo "boxd targets — orchestrate multi-step flows. For single-command operations,"
	@echo "use the 'boxd' CLI directly."
	@echo ""
	@echo "Golden VM:"
	@echo "  boxd-golden                          create <user>--langwatch-golden (canonical base)"
	@echo "  boxd-golden-reset                    BOXD_FORK_YES=1 to confirm destroy+rebuild"
	@echo "  (override the namespace prefix with BOXD_NAMESPACE=<name> for shared/team-owned goldens)"
	@echo ""
	@echo "Fork-for-source:"
	@echo "  boxd-fork-pr PR=<n>                  fork golden for an existing PR"
	@echo "  boxd-fork-branch BRANCH=<name>       fork golden for a branch"
	@echo "  boxd-fork-issue ISSUE=<n>            fork + worktree + tmux+claude inside VM"
	@echo ""
	@echo "Connect-by-source:"
	@echo "  boxd-connect-pr PR=<n>"
	@echo "  boxd-connect-branch BRANCH=<name>"
	@echo "  boxd-connect-issue ISSUE=<n>"
	@echo ""
	@echo "PR preview (ephemeral, team golden langwatch-golden-v2):"
	@echo "  boxd-preview BRANCH=<name>           fork team golden, checkout branch, start compose full"
	@echo "  boxd-preview-down BRANCH=<name>      destroy the preview VM"
	@echo "  boxd-preview-status BRANCH=<name>    print VM status, git HEAD, docker compose ps"
	@echo "  (override the source golden with LW_PREVIEW_GOLDEN_SOURCE=<name>)"
	@echo ""
	@echo "Naming: langwatch-<branch-slug> | langwatch-issue<N>; tmux: claude-<...>"
	@echo "Preview: preview-<branch-slug> (no namespace prefix)"
	@echo ""
	@echo "Customizable env vars:"
	@echo "  CLAUDE_CREDS=/path/to/credentials.json   override the source credentials"
	@echo "  BOXD_FORK_YES=1                          confirm destructive ops"
	@echo "  BOXD_NAMESPACE=<name>                    override golden namespace (default: gh user → whoami)"
	@echo "  LW_PREVIEW_GOLDEN_SOURCE=<name>          override the team golden for preview VMs (default: langwatch-golden-v2)"

# ---------------------------------------------------------------------------
# Argument guards
# ---------------------------------------------------------------------------

# Internal: require a make variable to be set (used by all targets that take a
# parameter). $$1 is the var name in the lookup; $$2 is its value.
# Usage in a recipe: @$(call _boxd_require,PR,$(PR))
define _boxd_require
	@test -n "$(2)" || { echo "ERROR: $(1) is required (e.g. make $@ $(1)=<value>)" >&2; exit 1; }
endef

# ---------------------------------------------------------------------------
# Golden VM
# ---------------------------------------------------------------------------

boxd-golden:
	@bash -c '$(BOXD_RUN_PREFIX) printf "→ boxd-golden: building canonical base VM \"%s\"\n" "$$(boxd_golden_vm_name)"'
	@bash -c '$(BOXD_RUN_PREFIX) boxd_golden'
	@$(MAKE) -s seed-golden

boxd-golden-reset:
	@bash -c '$(BOXD_RUN_PREFIX) printf "→ boxd-golden-reset: destroying + rebuilding \"%s\"\n" "$$(boxd_golden_vm_name)"'
	@bash -c '$(BOXD_RUN_PREFIX) BOXD_FORK_YES=$(BOXD_FORK_YES) boxd_golden_reset'
	@$(MAKE) -s seed-golden

# Hook target — quickstart/seed work fills this in when there's something to
# preload. By default it's a no-op and prints a hint (AC#7). Override in
# Makefile.local to provide a real seed implementation.
seed-golden:
	@bash -c '$(BOXD_RUN_PREFIX) printf "  (no seed-golden hook configured — define one in Makefile.local to seed %s)\n" "$$(boxd_golden_vm_name)"'

# ---------------------------------------------------------------------------
# Fork-for-source
# ---------------------------------------------------------------------------

boxd-fork-pr:
	$(call _boxd_require,PR,$(PR))
	@echo "→ boxd-fork-pr PR=$(PR)"
	@bash -c '$(BOXD_RUN_PREFIX) boxd_fork_pr "$(PR)"'

boxd-fork-branch:
	$(call _boxd_require,BRANCH,$(BRANCH))
	@echo "→ boxd-fork-branch BRANCH=$(BRANCH)"
	@bash -c '$(BOXD_RUN_PREFIX) boxd_fork_branch "$(BRANCH)"'

boxd-fork-issue:
	$(call _boxd_require,ISSUE,$(ISSUE))
	@echo "→ boxd-fork-issue ISSUE=$(ISSUE)"
	@bash -c '$(BOXD_RUN_PREFIX) boxd_fork_issue "$(ISSUE)"'

# ---------------------------------------------------------------------------
# Connect-by-source
# ---------------------------------------------------------------------------

boxd-connect-pr:
	$(call _boxd_require,PR,$(PR))
	@bash -c '$(BOXD_RUN_PREFIX) branch=$$(boxd_resolve_pr_branch "$(PR)") && boxd_connect pr "$$branch"'

boxd-connect-branch:
	$(call _boxd_require,BRANCH,$(BRANCH))
	@bash -c '$(BOXD_RUN_PREFIX) boxd_connect branch "$(BRANCH)"'

boxd-connect-issue:
	$(call _boxd_require,ISSUE,$(ISSUE))
	@bash -c '$(BOXD_RUN_PREFIX) boxd_connect issue "$(ISSUE)"'

# ---------------------------------------------------------------------------
# PR preview — ephemeral per-branch VMs
#
# Forks the team golden (langwatch-golden-v2 by default) rather than the
# per-user namespaced golden. Override with LW_PREVIEW_GOLDEN_SOURCE=<name>.
# VM naming: preview-<branch-slug> (no namespace prefix).
# ---------------------------------------------------------------------------

# boxd-preview BRANCH=<name>
# Fork the team golden into preview-<branch-slug>, check out the branch,
# start compose.dev.yml --profile full, and print the URL.
boxd-preview:
	$(call _boxd_require,BRANCH,$(BRANCH))
	@echo "→ boxd-preview BRANCH=$(BRANCH)"
	@LW_PREVIEW_GOLDEN_SOURCE="$(LW_PREVIEW_GOLDEN_SOURCE)" bash -c '$(BOXD_RUN_PREFIX) boxd_preview_up "$(BRANCH)"'

# boxd-preview-down BRANCH=<name>
# Destroy the preview VM non-interactively.
boxd-preview-down:
	$(call _boxd_require,BRANCH,$(BRANCH))
	@echo "→ boxd-preview-down BRANCH=$(BRANCH)"
	@bash -c '$(BOXD_RUN_PREFIX) boxd_preview_down "$(BRANCH)"'

# boxd-preview-status BRANCH=<name>
# Print VM status, current git branch + HEAD sha, and docker compose ps.
boxd-preview-status:
	$(call _boxd_require,BRANCH,$(BRANCH))
	@bash -c '$(BOXD_RUN_PREFIX) boxd_preview_status "$(BRANCH)"'
