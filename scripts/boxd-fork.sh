#!/usr/bin/env bash
# scripts/boxd-fork.sh — pure-shell helpers used by boxd.mk.
#
# The Makefile targets in boxd.mk delegate naming, env discovery, hostname
# rewrite, and orchestration sequencing to functions in this file so they
# can be unit-tested with bats independent of the boxd CLI.
#
# Conventions:
#   - Pure functions print to stdout, return 0/1, never `exit`.
#   - Side-effecting functions (boxd CLI calls) live in the orchestration
#     section at the bottom and are called from boxd.mk.
#
# Sourcing:
#   . scripts/boxd-fork.sh

set -uo pipefail

# ---------------------------------------------------------------------------
# Naming primitives
# ---------------------------------------------------------------------------

# boxd_slug — slugify a string per issue #3891 AC#13.
# Lowercase, replace `/` and non-`[a-z0-9-]` with `-`, collapse repeated `-`,
# trim leading/trailing `-`, truncate at 40 chars (no word-boundary cut).
boxd_slug() {
  local input="${1-}"
  local s
  s=$(printf '%s' "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's#/+#-#g; s/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+//; s/-+$//')
  if [ "${#s}" -gt 40 ]; then
    s="${s:0:40}"
    s="${s%-}"
  fi
  printf '%s' "$s"
}

# boxd_vm_name SOURCE INPUT — return the VM name for the given source-of-truth.
# SOURCE: pr | branch | issue
# INPUT:  PR number / branch name / issue number
#
# Per AC#9 + AC#14:
#   - issue → always literal `langwatch-issue<N>` (no slugifier on input)
#   - pr / branch → `langwatch-<slug(input)>`
boxd_vm_name() {
  local source="${1-}" input="${2-}"
  case "$source" in
    issue)
      printf 'langwatch-issue%s' "$input"
      ;;
    pr|branch)
      printf 'langwatch-%s' "$(boxd_slug "$input")"
      ;;
    *)
      echo "boxd_vm_name: unknown source '$source' (expected pr|branch|issue)" >&2
      return 1
      ;;
  esac
}

# boxd_tmux_name SOURCE INPUT — return the tmux session name on the VM.
# Same shape as boxd_vm_name but with `claude-` prefix instead of `langwatch-`.
boxd_tmux_name() {
  local source="${1-}" input="${2-}"
  case "$source" in
    issue)
      printf 'claude-issue%s' "$input"
      ;;
    pr|branch)
      printf 'claude-%s' "$(boxd_slug "$input")"
      ;;
    *)
      echo "boxd_tmux_name: unknown source '$source' (expected pr|branch|issue)" >&2
      return 1
      ;;
  esac
}

# boxd_branch_issue_collision_warning SLUG — print a friendly nudge if the
# branch slug starts with `issue<N>-`, suggesting `fork-issue` instead.
# Per AC#14: warn-only, doesn't error.
boxd_branch_issue_collision_warning() {
  local slug="${1-}"
  if [[ "$slug" =~ ^issue([0-9]+)- ]]; then
    local n="${BASH_REMATCH[1]}"
    cat <<EOF >&2
warning: branch slug '$slug' looks like it belongs to issue $n.
         Consider 'make boxd-fork-issue ISSUE=$n' instead — that target
         uses the canonical 'langwatch-issue$n' VM name and creates a
         matching 'claude-issue$n' tmux session.
EOF
  fi
}

# ---------------------------------------------------------------------------
# Environment file discovery and rewrite
# ---------------------------------------------------------------------------

# boxd_env_files — print every `.env` file under PWD that should be uploaded
# to a fork, one per line, with leading `./`.
#
# Excludes (AC#24):
#   - directories: node_modules, .next, dist, build, .git, vendor, coverage
#   - file suffixes: .example, .template, .sample, .local
boxd_env_files() {
  find . \
    -type d \( \
      -name node_modules -o \
      -name .next -o \
      -name dist -o \
      -name build -o \
      -name .git -o \
      -name vendor -o \
      -name coverage \
    \) -prune -o \
    -type f -name '.env' -print
}

# boxd_rewrite_env VM_NAME — read .env content on stdin, write a rewritten
# version on stdout where stale localhost-pinned values point at the fork's
# proxy URL.
#
# Rewrite trigger (AC#26): a value matches `https?://(localhost|127\.0\.0\.1):<port>`.
# Comments, blank lines, and non-matching values pass through untouched.
#
# Special-target keys: LW_GATEWAY_BASE_URL routes to `aigw.<vm>.boxd.sh`.
# Default target: `<vm>.boxd.sh`.
#
# Output values are double-quoted for shell-safety, mirroring the format
# in `langwatch/.env.example`.
boxd_rewrite_env() {
  local vm="${1-}"
  if [ -z "$vm" ]; then
    echo "boxd_rewrite_env: VM_NAME is required" >&2
    return 1
  fi
  local default_url="https://${vm}.boxd.sh"
  local aigw_url="https://aigw.${vm}.boxd.sh"

  # Use awk for line-level rewrite — easier to read than nested sed.
  awk -v default_url="$default_url" -v aigw_url="$aigw_url" '
    function rewrite(key,    target) {
      target = (key == "LW_GATEWAY_BASE_URL") ? aigw_url : default_url
      printf "%s=\"%s\"\n", key, target
    }
    # Comments + blank lines pass through verbatim.
    /^[[:space:]]*(#|$)/ { print; next }
    # Match: KEY=...localhost:PORT... or KEY=...127.0.0.1:PORT...
    # Anchored to scheme so we do not mangle e.g. `note=localhost:5560 is fine`.
    {
      key = ""
      eq = index($0, "=")
      if (eq > 0) {
        key = substr($0, 1, eq - 1)
        # Strip whitespace and `export ` prefix from key
        sub(/^[[:space:]]*(export[[:space:]]+)?/, "", key)
        sub(/[[:space:]]+$/, "", key)
        val = substr($0, eq + 1)
        # Strip leading whitespace and matching quotes from value
        sub(/^[[:space:]]*/, "", val)
        if (val ~ /^".*"$/) { val = substr(val, 2, length(val) - 2) }
        else if (val ~ /^'\''.*'\''$/) { val = substr(val, 2, length(val) - 2) }

        if (val ~ /^https?:\/\/(localhost|127\.0\.0\.1):[0-9]+(\/.*)?$/) {
          rewrite(key)
          next
        }
      }
      print
    }
  '
}

# ---------------------------------------------------------------------------
# Orchestration helpers (boxd CLI side-effects)
# ---------------------------------------------------------------------------

# Tunable bin paths — overridable in tests via env vars.
BOXD_BIN="${BOXD_BIN:-boxd}"
GH_BIN="${GH_BIN:-gh}"
GIT_BIN="${GIT_BIN:-git}"

# Default port mapping. Each entry is `subdomain:port`. The first entry is
# special: subdomain `_default` means `boxd proxy set-port` (the bare
# https://<vm>.boxd.sh URL points there). The rest are per-subdomain proxies.
BOXD_FORK_PORTS=(
  "_default:5560"      # langwatch app (compose mode)
  "aigw:5563"          # AI gateway (Go data plane)
  "bullboard:6380"
  "ai-server:3456"
  "next:3000"          # Next.js standalone `pnpm dev` mode
)

# Repo we operate on. Override with REPO env var when running in mock mode.
BOXD_FORK_REPO="${BOXD_FORK_REPO:-langwatch/langwatch}"

# Default Claude credentials path (AC#22).
BOXD_CLAUDE_CREDS="${CLAUDE_CREDS:-$HOME/.claude/.credentials.json}"

# boxd_vm_exists VM — true if a VM with that name exists.
# Uses the same spacing-tolerant regex as boxd_vm_status so both functions
# parse `boxd list --json` output consistently regardless of whether the
# CLI compacts or pretty-prints the response.
boxd_vm_exists() {
  local vm="${1-}"
  [ -n "$vm" ] || return 1
  "$BOXD_BIN" list --json 2>/dev/null \
    | grep -qE "\"name\"[[:space:]]*:[[:space:]]*\"$vm\"" \
    || return 1
}

# boxd_vm_status VM — print one of `running`, `standby`, `paused`, `unknown`.
boxd_vm_status() {
  local vm="${1-}"
  "$BOXD_BIN" list --json 2>/dev/null \
    | awk -v vm="$vm" '
      /"name":[[:space:]]*"/ {
        match($0, /"name":[[:space:]]*"[^"]*"/)
        n = substr($0, RSTART+8, RLENGTH-9)
        gsub(/^"/, "", n); gsub(/"$/, "", n)
        cur_name = n
      }
      /"status":[[:space:]]*"/ && cur_name == vm {
        match($0, /"status":[[:space:]]*"[^"]*"/)
        s = substr($0, RSTART+10, RLENGTH-11)
        gsub(/^"/, "", s); gsub(/"$/, "", s)
        print s; exit
      }
    '
}

# boxd_resolve_pr_branch PR — print the head ref of a PR via gh, supporting
# cross-fork PRs (AC#16). Empty + nonzero exit on failure.
boxd_resolve_pr_branch() {
  local pr="${1-}"
  [ -n "$pr" ] || { echo "PR number required" >&2; return 1; }
  "$GH_BIN" pr view "$pr" --repo "$BOXD_FORK_REPO" --json headRefName --jq .headRefName
}

# boxd_upload_envs VM — discover every `.env` file under PWD, rewrite stale
# localhost values, and copy each to the corresponding path in the VM
# (AC#25: each .env stays separate; no merging).
boxd_upload_envs() {
  local vm="${1-}"
  [ -n "$vm" ] || { echo "VM name required" >&2; return 1; }
  local f rel rewritten target
  while IFS= read -r f; do
    rel="${f#./}"
    rewritten=$(mktemp)
    boxd_rewrite_env "$vm" < "$f" > "$rewritten"
    # Preserve monorepo path under /home/boxd/langwatch (the in-VM repo path)
    target="langwatch/$rel"
    "$BOXD_BIN" cp "$rewritten" "$vm:$target" >/dev/null
    rm -f "$rewritten"
    printf '  uploaded %s\n' "$rel" >&2
  done < <(boxd_env_files)
}

# boxd_upload_creds VM — copy Claude credentials into the VM (AC#22).
boxd_upload_creds() {
  local vm="${1-}"
  [ -n "$vm" ] || { echo "VM name required" >&2; return 1; }
  if [ ! -f "$BOXD_CLAUDE_CREDS" ]; then
    cat <<EOF >&2
WARNING: Claude credentials not found at $BOXD_CLAUDE_CREDS.
         The fork will not have an authenticated Claude. Override with:
           CLAUDE_CREDS=/path/to/credentials.json make boxd-fork-...
         Or run 'claude login' inside the VM after fork (\`boxd connect $vm\`).
EOF
    return 0
  fi
  "$BOXD_BIN" cp "$BOXD_CLAUDE_CREDS" "$vm:.claude/.credentials.json" >/dev/null
  printf '  uploaded Claude credentials\n' >&2
}

# boxd_map_ports VM — set up the standard set of proxies (AC#27).
# Uses host-side `--vm` so we don't pay an extra `boxd exec` round-trip per
# proxy just to invoke the in-VM CLI against itself.
boxd_map_ports() {
  local vm="${1-}"
  [ -n "$vm" ] || { echo "VM name required" >&2; return 1; }
  local entry sub port
  for entry in "${BOXD_FORK_PORTS[@]}"; do
    sub="${entry%%:*}"
    port="${entry##*:}"
    if [ "$sub" = "_default" ]; then
      "$BOXD_BIN" proxy set-port --port="$port" --vm "$vm" >/dev/null 2>&1 || true
      printf '  proxy: https://%s.boxd.sh -> :%s\n' "$vm" "$port" >&2
    else
      # `proxy new` errors if the subdomain already exists; that's idempotent.
      "$BOXD_BIN" proxy new "$sub" --port="$port" --vm "$vm" >/dev/null 2>&1 || true
      printf '  proxy: https://%s.%s.boxd.sh -> :%s\n' "$sub" "$vm" "$port" >&2
    fi
  done
}

# boxd_wake_if_suspended VM — resume the VM if it's paused/standby (AC#20).
boxd_wake_if_suspended() {
  local vm="${1-}"
  [ -n "$vm" ] || return 1
  local status
  status=$(boxd_vm_status "$vm")
  case "$status" in
    paused|standby|suspended)
      printf '  resuming suspended VM %s\n' "$vm" >&2
      "$BOXD_BIN" resume "$vm" >/dev/null 2>&1 || true
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Top-level orchestration — driven by boxd.mk targets
# ---------------------------------------------------------------------------

# Internal: the shared fork primitive (AC#10).
# Args: SOURCE VM_INPUT USER_ARG BRANCH [START_TMUX [PR]]
#   SOURCE     pr | branch | issue
#   VM_INPUT   value passed to boxd_vm_name (PR's branch, branch name, or issue number)
#   USER_ARG   value the user originally typed — used to echo back the right
#              connect command. fork-pr: PR number, fork-branch: branch,
#              fork-issue: issue number.
#   BRANCH     the actual git branch to check out inside the fork
#   START_TMUX 1 to start a Claude tmux session (fork-issue), 0 otherwise
#   PR         optional PR number; when set, checkout uses `gh pr checkout`
#              inside the fork to handle PRs from forked repos (AC#16).
_boxd_fork_impl() {
  local source="$1" input="$2" user_arg="$3" branch="$4" start_tmux="${5:-0}" pr="${6:-}"
  local vm tmux arg_name
  vm=$(boxd_vm_name "$source" "$input")
  tmux=$(boxd_tmux_name "$source" "$input")
  arg_name=$(_boxd_arg_for_source "$source")

  printf 'Forking VM: %s (branch=%s, tmux=%s)\n' "$vm" "$branch" "$tmux" >&2
  printf '  proxies: https://%s.boxd.sh and configured subdomains\n' "$vm" >&2

  # AC#15: existing VM is an error, not a silent re-fork.
  if boxd_vm_exists "$vm"; then
    cat <<EOF >&2
ERROR: VM '$vm' already exists. Pick a different source or destroy it first:
         boxd destroy $vm
       Or connect to it:
         make boxd-connect-${source} ${arg_name}=${user_arg}
EOF
    return 1
  fi

  # AC#10 / AC#11: fork from langwatch-golden, then check out the branch.
  if ! "$BOXD_BIN" fork langwatch-golden --name="$vm" >/dev/null; then
    echo "ERROR: 'boxd fork langwatch-golden --name=$vm' failed." >&2
    return 1
  fi

  # AC#16: for fork-pr, prefer `gh pr checkout` — it handles PRs from
  # forked repos by adding the contributor's remote automatically.
  # For branch/issue, fall back to fetch-then-checkout against origin.
  # Fails closed: a partial fork (envs + proxies wired against the wrong
  # branch) is worse than a hard error.
  if [ -n "$pr" ]; then
    if ! "$BOXD_BIN" exec "$vm" -- "cd langwatch && gh pr checkout '$pr' --force 2>&1" >/dev/null; then
      cat <<EOF >&2
ERROR: 'gh pr checkout $pr' failed inside $vm. If the PR is from a fork
       repo, the in-VM gh may not have access to it. Inspect with:
         boxd connect $vm
         cd langwatch && gh auth status && gh pr checkout $pr
       Aborting before envs / proxies are wired against the wrong branch.
EOF
      return 1
    fi
  else
    if ! "$BOXD_BIN" exec "$vm" -- "cd langwatch && git fetch origin && git checkout '$branch' 2>/dev/null || git checkout -b '$branch' 'origin/$branch' 2>/dev/null || git checkout 'origin/$branch'" >/dev/null; then
      echo "ERROR: failed to check out '$branch' inside $vm." >&2
      return 1
    fi
  fi

  boxd_upload_creds "$vm"
  boxd_upload_envs "$vm"
  boxd_map_ports "$vm"

  if [ "$start_tmux" = "1" ]; then
    # AC#12: tmux + Claude session inside the VM, named claude-<slug>/issue<N>.
    if "$BOXD_BIN" exec "$vm" -- \
        "tmux new-session -d -s '$tmux' 'cd langwatch && claude --dangerously-skip-permissions'" \
        >/dev/null 2>&1; then
      printf '  started tmux session %s on %s\n' "$tmux" "$vm" >&2
    else
      printf '  WARNING: failed to start tmux session %s on %s — start it manually after `boxd connect %s`\n' "$tmux" "$vm" "$vm" >&2
    fi
  fi

  printf 'Done. Connect with:\n  make boxd-connect-%s %s=%s\n' \
    "${source}" "$(_boxd_arg_for_source "$source")" "$user_arg" >&2
}

# Helper: print the variable name expected by the connect target for a source.
_boxd_arg_for_source() {
  case "${1-}" in
    pr) printf 'PR' ;;
    branch) printf 'BRANCH' ;;
    issue) printf 'ISSUE' ;;
  esac
}

# boxd_fork_pr PR — fork the golden VM for an existing PR.
# Resolves head ref via gh, including PRs from forked repos (AC#16).
boxd_fork_pr() {
  local pr="${1-}"
  [ -n "$pr" ] || { echo "usage: make boxd-fork-pr PR=<number>" >&2; return 1; }
  local branch
  branch=$(boxd_resolve_pr_branch "$pr") || {
    echo "ERROR: could not resolve PR #$pr via gh." >&2
    return 1
  }
  # gh can return exit 0 with empty output on permissions edge cases —
  # guard so we don't synthesize a degenerate VM name like `langwatch-`.
  if [ -z "$branch" ]; then
    echo "ERROR: gh returned an empty headRefName for PR #$pr." >&2
    return 1
  fi
  local slug
  slug=$(boxd_slug "$branch")
  boxd_branch_issue_collision_warning "$slug"
  # Pass $pr as the 6th arg so _boxd_fork_impl uses `gh pr checkout` (AC#16:
  # cross-fork PR support — gh adds the contributor's remote automatically).
  _boxd_fork_impl pr "$branch" "$pr" "$branch" 0 "$pr"
}

# boxd_fork_branch BRANCH — fork for a branch that doesn't (yet) have a PR.
boxd_fork_branch() {
  local branch="${1-}"
  [ -n "$branch" ] || { echo "usage: make boxd-fork-branch BRANCH=<name>" >&2; return 1; }
  local slug
  slug=$(boxd_slug "$branch")
  boxd_branch_issue_collision_warning "$slug"
  _boxd_fork_impl branch "$branch" "$branch" "$branch" 0
}

# boxd_fork_issue ISSUE — fork for an issue without a PR yet. Creates the
# worktree branch on the host (idempotent: reuses existing per AC#15) and
# starts a tmux + Claude session inside the VM (AC#12).
boxd_fork_issue() {
  local issue="${1-}"
  [ -n "$issue" ] || { echo "usage: make boxd-fork-issue ISSUE=<number>" >&2; return 1; }

  # Resolve issue title via gh, build branch via existing worktree.sh logic.
  local title slug branch
  title=$("$GH_BIN" issue view "$issue" --repo "$BOXD_FORK_REPO" --json title --jq .title) \
    || { echo "ERROR: could not resolve issue #$issue via gh." >&2; return 1; }
  # Inline the worktree.sh slug rules (max 50, word-boundary truncation)
  # to avoid sourcing it from here. Keep VM name on the canonical issue<N>
  # form regardless of title.
  slug=$(printf '%s' "$title" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/-+/-/g; s/^-+//; s/-+$//')
  if [ "${#slug}" -gt 50 ]; then
    slug="${slug:0:50}"
    slug="${slug%-*}"
    slug="${slug%-}"
  fi
  branch="issue${issue}/${slug}"

  # AC#15: reuse worktree branch if it already exists, no error/no overwrite.
  if "$GIT_BIN" rev-parse --verify "$branch" >/dev/null 2>&1; then
    printf 'Reusing existing local branch: %s\n' "$branch" >&2
  else
    printf 'Creating worktree branch: %s\n' "$branch" >&2
    if [ -x "$(dirname "${BASH_SOURCE[0]}")/worktree.sh" ]; then
      "$(dirname "${BASH_SOURCE[0]}")/worktree.sh" "$issue" >/dev/null \
        || printf 'NOTE: worktree.sh did not complete cleanly — branch may not exist locally.\n' >&2
    fi
  fi

  _boxd_fork_impl issue "$issue" "$issue" "$branch" 1
}

# boxd_golden — build the golden VM. If it already exists, this is a no-op
# pointing the user at boxd-golden-reset (AC#5).
boxd_golden() {
  local vm="langwatch-golden"
  if boxd_vm_exists "$vm"; then
    cat <<EOF >&2
'$vm' already exists. To rebuild from scratch:
  make boxd-golden-reset
EOF
    return 0
  fi
  printf 'Creating golden VM %s\n' "$vm" >&2
  if ! "$BOXD_BIN" new --name="$vm" >/dev/null; then
    echo "ERROR: 'boxd new --name=$vm' failed." >&2
    return 1
  fi
  # Provision: install Node 20 from NodeSource (apt's `nodejs` ships Node
  # 12.x on Ubuntu 22.04 — older than corepack's 16.9.0 minimum, which
  # would silently abort the rest of the recipe under `set -e`). Then
  # clone repo and install deps. The `set -e` is INSIDE the remote shell
  # only; we additionally check the host-side `boxd exec` exit code so
  # provisioning failures don't slip past the success printf.
  if ! "$BOXD_BIN" exec "$vm" -- "
    set -euo pipefail
    if ! command -v node >/dev/null 2>&1 \\
       || [ \"\$(node --version 2>/dev/null | cut -d. -f1 | tr -d v)\" -lt 18 ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    fi
    if [ ! -d langwatch ]; then
      git clone https://github.com/$BOXD_FORK_REPO.git langwatch
    fi
    cd langwatch && corepack enable && pnpm -w install
  "; then
    echo "ERROR: provisioning $vm failed. Inspect with 'boxd connect $vm'." >&2
    return 1
  fi
  # Hook for seed-golden (AC#7): callable target the make file overrides.
  printf 'Done. Override the seed step by defining a seed-golden target.\n' >&2
}

# boxd_golden_reset — destroy + rebuild langwatch-golden (AC#6).
# Requires user confirmation per AC#4 (destructive).
boxd_golden_reset() {
  local vm="langwatch-golden"
  if [ "${BOXD_FORK_YES:-}" != "1" ]; then
    printf 'This will destroy %s and rebuild it. Re-run with BOXD_FORK_YES=1 to confirm.\n' "$vm" >&2
    return 1
  fi
  if boxd_vm_exists "$vm"; then
    printf 'Destroying %s\n' "$vm" >&2
    "$BOXD_BIN" destroy "$vm" >/dev/null 2>&1 || true
  fi
  boxd_golden
}

# boxd_connect SOURCE INPUT — SSH into the matching VM and tmux-attach.
# Shared resolution logic for connect-pr / connect-branch / connect-issue
# (AC#17 + AC#21).
boxd_connect() {
  local source="${1-}" input="${2-}"
  local vm tmux
  vm=$(boxd_vm_name "$source" "$input") || return 1
  tmux=$(boxd_tmux_name "$source" "$input") || return 1

  if ! boxd_vm_exists "$vm"; then
    cat <<EOF >&2
ERROR: VM '$vm' does not exist. Create it first:
  make boxd-fork-${source} $(_boxd_arg_for_source "$source")=$input
EOF
    return 1
  fi

  boxd_wake_if_suspended "$vm"

  # AC#18: if the tmux session is missing, print a clear message and exit
  # nonzero — don't drop into a shell where the user expects an attach.
  local tmux_check
  tmux_check=$("$BOXD_BIN" exec "$vm" -- "tmux has-session -t '$tmux' 2>/dev/null && echo OK" 2>/dev/null || true)
  if [ "$tmux_check" != "OK" ]; then
    cat <<EOF >&2
ERROR: no claude session found on VM '$vm'.
       Run 'make boxd-fork-${source} $(_boxd_arg_for_source "$source")=$input' first
       or start one manually:
         boxd connect $vm
         tmux new -s $tmux
EOF
    return 1
  fi

  exec "$BOXD_BIN" connect "$vm" --command "tmux attach -t '$tmux'"
}
