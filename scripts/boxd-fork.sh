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
# Shell-quote helper — single-quote safe interpolation
# ---------------------------------------------------------------------------
# Wrap an arbitrary value so it can be safely embedded in a single-quoted
# string passed to a remote shell (`boxd exec "..."`, `ssh host '...'`).
# Replaces every `'` with `'\''` and wraps the result in `'...'`.
#
# Usage:
#   safe_pr=$(_boxd_shell_quote "$pr")
#   "$BOXD_BIN" exec "$vm" -- "gh pr checkout $safe_pr"
#
# Without this, a value containing `'; rm -rf /; echo '` interpolated into a
# `'$x'` slot would close the quote and execute as a separate command. We
# additionally validate input shape at the entry points (digit-only PR
# numbers, git-ref-format branches, slugified tmux names) — quoting is the
# defense-in-depth so a missed validation does not become an RCE.
_boxd_shell_quote() {
  local s="${1-}"
  # Inline %s -> %s_with_quotes_escaped using bash parameter expansion.
  printf "'%s'" "${s//\'/\'\\\'\'}"
}

# ---------------------------------------------------------------------------
# Naming primitives
# ---------------------------------------------------------------------------

# boxd_namespace — return the per-user/team prefix for shared boxd VM names.
# Boxd subdomains are globally unique across all accounts, so any VM name we
# create needs a stable prefix to avoid colliding with other LangWatch users
# / teams who also dev on boxd.
#
# Resolution order:
#   1. $BOXD_NAMESPACE (explicit override, e.g. for shared/team-owned goldens)
#   2. `gh api user --jq .login` (the human's GitHub login — stable, distinct)
#   3. `whoami` (last-resort fallback when gh is offline / not auth'd)
#
# Output is slugified through the same rules as boxd_slug for safety.
boxd_namespace() {
  local raw=""
  if [ -n "${BOXD_NAMESPACE:-}" ]; then
    raw="$BOXD_NAMESPACE"
  elif raw=$("$GH_BIN" api user --jq .login 2>/dev/null) && [ -n "$raw" ]; then
    :
  else
    raw=$(whoami 2>/dev/null || echo unknown)
  fi
  boxd_slug "$raw"
}

# boxd_golden_vm_name — return the namespaced golden VM name.
# Pattern: <namespace>--langwatch-golden (e.g. drewdrewthis--langwatch-golden).
# The `--` separator is intentional — visually distinct from intra-segment
# hyphens, fully RFC-1035-compliant inside a DNS label.
boxd_golden_vm_name() {
  local ns
  ns=$(boxd_namespace) || return 1
  printf '%s--langwatch-golden' "$ns"
}

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
    if ! "$BOXD_BIN" cp "$rewritten" "$vm:$target" >/dev/null; then
      rm -f "$rewritten"
      echo "ERROR: failed to upload $rel to $vm:$target" >&2
      return 1
    fi
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
  if ! "$BOXD_BIN" cp "$BOXD_CLAUDE_CREDS" "$vm:.claude/.credentials.json" >/dev/null; then
    echo "ERROR: failed to upload Claude credentials to $vm" >&2
    return 1
  fi
  printf '  uploaded Claude credentials\n' >&2
}

# boxd_map_ports VM — set up the standard set of proxies (AC#27).
# Uses host-side `--vm` so we don't pay an extra `boxd exec` round-trip per
# proxy just to invoke the in-VM CLI against itself.
boxd_map_ports() {
  local vm="${1-}"
  [ -n "$vm" ] || { echo "VM name required" >&2; return 1; }
  local entry sub port out failed=0
  for entry in "${BOXD_FORK_PORTS[@]}"; do
    sub="${entry%%:*}"
    port="${entry##*:}"
    if [ "$sub" = "_default" ]; then
      if out=$("$BOXD_BIN" proxy set-port --port="$port" --vm "$vm" 2>&1); then
        printf '  proxy: https://%s.boxd.sh -> :%s\n' "$vm" "$port" >&2
      else
        printf '  ERROR: failed to set default proxy for %s -> :%s\n%s\n' "$vm" "$port" "$out" >&2
        failed=1
      fi
    else
      # `proxy new` errors if the subdomain already exists; that's idempotent.
      if out=$("$BOXD_BIN" proxy new "$sub" --port="$port" --vm "$vm" 2>&1); then
        printf '  proxy: https://%s.%s.boxd.sh -> :%s\n' "$sub" "$vm" "$port" >&2
      elif printf '%s' "$out" | grep -qiE 'already exists|conflict'; then
        printf '  proxy: https://%s.%s.boxd.sh -> :%s (existing)\n' "$sub" "$vm" "$port" >&2
      else
        printf '  ERROR: failed to create proxy %s.%s.boxd.sh -> :%s\n%s\n' "$sub" "$vm" "$port" "$out" >&2
        failed=1
      fi
    fi
  done
  return $failed
}

# boxd_wake_if_suspended VM — resume the VM if it's paused/standby (AC#20).
# `boxd resume` returns as soon as the request is dispatched, but the VM
# isn't actually accepting `boxd exec` until it reaches `running`. Poll the
# status with a 30s budget so callers (boxd exec / boxd connect) don't
# silently fail with confusing errors against a not-yet-ready VM.
boxd_wake_if_suspended() {
  local vm="${1-}"
  [ -n "$vm" ] || return 1
  local status
  status=$(boxd_vm_status "$vm")
  case "$status" in
    paused|standby|suspended)
      printf '  resuming suspended VM %s\n' "$vm" >&2
      "$BOXD_BIN" resume "$vm" >/dev/null 2>&1 || true
      local i=0
      while [ "$i" -lt "${BOXD_RESUME_TIMEOUT_SECS:-30}" ]; do
        if [ "$(boxd_vm_status "$vm")" = "running" ]; then
          return 0
        fi
        sleep 1
        i=$((i + 1))
      done
      printf '  WARNING: VM %s did not reach running state within %ss\n' \
        "$vm" "${BOXD_RESUME_TIMEOUT_SECS:-30}" >&2
      return 1
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

  # For fork-branch / fork-issue, the in-VM checkout below uses `git fetch
  # origin && git checkout '$branch'` — that requires the ref to exist on
  # the origin remote. fork-pr handles its own remotes via `gh pr checkout`.
  # Push the local branch to origin first so the in-VM checkout can find
  # it; bail with a clear hint if push fails (no upstream, no auth, etc.).
  if [ -z "$pr" ]; then
    if ! "$GIT_BIN" rev-parse --verify "refs/remotes/origin/$branch" >/dev/null 2>&1; then
      printf '  pushing %s to origin (required for in-VM checkout)\n' "$branch" >&2
      if ! "$GIT_BIN" push -u origin "$branch" 2>&1; then
        cat <<EOF >&2
ERROR: 'git push -u origin $branch' failed.
       The in-VM checkout needs origin/$branch to exist. Push the branch
       manually (or set its upstream) and re-run, or use fork-pr if this
       branch is already in a PR.
EOF
        return 1
      fi
    fi
  fi

  # AC#10 / AC#11: fork from the namespaced golden, then check out the branch.
  local golden
  golden=$(boxd_golden_vm_name) || return 1
  if ! "$BOXD_BIN" fork "$golden" --name="$vm" >/dev/null; then
    echo "ERROR: 'boxd fork $golden --name=$vm' failed." >&2
    cat <<EOF >&2
       Did you build the golden VM yet? It is not shared across boxd accounts:
         make boxd-golden
       Override the namespace explicitly with BOXD_NAMESPACE=<name> if needed.
EOF
    return 1
  fi

  # AC#16: for fork-pr, prefer `gh pr checkout` — it handles PRs from
  # forked repos by adding the contributor's remote automatically.
  # For branch/issue, fall back to fetch-then-checkout against origin.
  # Fails closed: a partial fork (envs + proxies wired against the wrong
  # branch) is worse than a hard error.
  #
  # Quoting: every variable interpolated into the remote shell string is
  # run through _boxd_shell_quote so a value containing a single quote
  # can't escape its slot and inject a command. Defense-in-depth on top
  # of the upstream shape validation (digit-only PR, git-ref-format
  # branch).
  if [ -n "$pr" ]; then
    local q_pr
    q_pr=$(_boxd_shell_quote "$pr")
    if ! "$BOXD_BIN" exec "$vm" -- "cd langwatch && gh pr checkout $q_pr --force 2>&1" >/dev/null; then
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
    local q_branch q_origin_branch
    q_branch=$(_boxd_shell_quote "$branch")
    q_origin_branch=$(_boxd_shell_quote "origin/$branch")
    if ! "$BOXD_BIN" exec "$vm" -- "cd langwatch && git fetch origin && git checkout $q_branch 2>/dev/null || git checkout -b $q_branch $q_origin_branch 2>/dev/null || git checkout $q_origin_branch" >/dev/null; then
      echo "ERROR: failed to check out '$branch' inside $vm." >&2
      return 1
    fi
  fi

  boxd_upload_creds "$vm" || return 1
  boxd_upload_envs "$vm" || return 1
  boxd_map_ports "$vm" || return 1

  if [ "$start_tmux" = "1" ]; then
    # AC#12: tmux + Claude session inside the VM, named claude-<slug>/issue<N>.
    # $tmux comes from boxd_tmux_name which derives from a slugified source
    # (already constrained to [a-z0-9-]+), but quote it anyway so a future
    # change upstream can't turn an injection into an RCE.
    local q_tmux
    q_tmux=$(_boxd_shell_quote "$tmux")
    if "$BOXD_BIN" exec "$vm" -- \
        "tmux new-session -d -s $q_tmux 'cd langwatch && claude --dangerously-skip-permissions'" \
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
  # Shape-validate before anything touches a remote shell — PR is digits only.
  if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
    echo "ERROR: PR must be a positive integer, got: $pr" >&2
    return 1
  fi
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
  # git's own validator catches injection patterns ($, `, ;, newlines, etc.).
  if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
    echo "ERROR: '$branch' is not a valid git branch name." >&2
    return 1
  fi
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
  # Shape-validate before anything touches a remote shell — issue is digits only.
  if ! [[ "$issue" =~ ^[0-9]+$ ]]; then
    echo "ERROR: ISSUE must be a positive integer, got: $issue" >&2
    return 1
  fi

  # Resolve issue title via gh, build branch via existing worktree.sh logic.
  local title slug branch
  title=$("$GH_BIN" issue view "$issue" --repo "$BOXD_FORK_REPO" --json title --jq .title) \
    || { echo "ERROR: could not resolve issue #$issue via gh." >&2; return 1; }
  # Mirror the empty-headRefName guard above — gh can return exit 0 with an
  # empty .title on permissions/edge cases, which would slug to "" and yield
  # a degenerate ref like `issue<N>/`.
  if [ -z "$title" ]; then
    echo "ERROR: gh returned an empty title for issue #$issue." >&2
    return 1
  fi
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

# boxd_golden — build the namespaced golden VM. If it already exists, this is
# a no-op pointing the user at boxd-golden-reset (AC#5).
boxd_golden() {
  local vm
  vm=$(boxd_golden_vm_name) || return 1
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
  # Validate $BOXD_FORK_REPO before interpolating it into the remote shell.
  # GitHub repo grammar: owner/repo, each segment [A-Za-z0-9._-]+, no
  # slashes inside a segment. Without this guard, a value like
  # 'evil; curl x|sh #' would inject commands during golden provisioning.
  if ! [[ "${BOXD_FORK_REPO:-}" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
    echo "ERROR: BOXD_FORK_REPO ('${BOXD_FORK_REPO:-}') is not a valid <owner>/<repo>." >&2
    return 1
  fi
  # Provision: install Node 20 from NodeSource (apt's `nodejs` ships Node
  # 12.x on Ubuntu 22.04 — older than corepack's 16.9.0 minimum, which
  # would silently abort the rest of the recipe under `set -e`). Then
  # clone repo and install deps. The `set -e` is INSIDE the remote shell
  # only; we additionally check the host-side `boxd exec` exit code so
  # provisioning failures don't slip past the success printf.
  #
  # $BOXD_FORK_REPO is interpolated directly into the remote shell here —
  # safe because the regex validation above restricts it to
  # [A-Za-z0-9._-]+/[A-Za-z0-9._-]+ (no shell metacharacters possible).
  # boxd exec runs the remote command under /bin/sh (dash on Ubuntu/Debian),
  # which doesn't grok 'set -o pipefail'. Wrap in 'bash -c' so the recipe
  # gets bash semantics — pipefail is load-bearing for curl|bash safety.
  if ! "$BOXD_BIN" exec "$vm" -- bash -c "
    set -euo pipefail
    if ! command -v node >/dev/null 2>&1 \\
       || [ \"\$(node --version 2>/dev/null | cut -d. -f1 | tr -d v)\" -lt 18 ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    fi
    if [ ! -d langwatch ]; then
      git clone https://github.com/$BOXD_FORK_REPO.git langwatch
    fi
    cd langwatch && sudo corepack enable && pnpm -w install
  "; then
    echo "ERROR: provisioning $vm failed. Inspect with 'boxd connect $vm'." >&2
    return 1
  fi
  # Hook for seed-golden (AC#7): callable target the make file overrides.
  printf 'Done. Override the seed step by defining a seed-golden target.\n' >&2
}

# boxd_golden_reset — destroy + rebuild the namespaced golden VM (AC#6).
# Requires user confirmation per AC#4 (destructive).
boxd_golden_reset() {
  local vm
  vm=$(boxd_golden_vm_name) || return 1
  if [ "${BOXD_FORK_YES:-}" != "1" ]; then
    printf 'This will destroy %s and rebuild it. Re-run with BOXD_FORK_YES=1 to confirm.\n' "$vm" >&2
    return 1
  fi
  if boxd_vm_exists "$vm"; then
    printf 'Destroying %s\n' "$vm" >&2
    # `boxd destroy` requires --confirm/-y to be non-interactive. We've
    # already gated on BOXD_FORK_YES=1 above for user-level consent.
    if ! "$BOXD_BIN" destroy "$vm" -y >/dev/null 2>&1; then
      echo "ERROR: 'boxd destroy $vm' failed; aborting reset." >&2
      return 1
    fi
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

# ---------------------------------------------------------------------------
# Preview lifecycle — ephemeral per-branch PR-preview VMs
#
# Naming convention: preview-<slug(branch)>
# Source golden:     $LW_PREVIEW_GOLDEN_SOURCE (default: langwatch-golden-v2)
#
# Three entry points driven by boxd.mk targets:
#   boxd_preview_up   BRANCH — fork golden, checkout branch, start compose full
#   boxd_preview_down BRANCH — destroy the preview VM non-interactively
#   boxd_preview_status BRANCH — print VM status, git HEAD, docker compose ps
# ---------------------------------------------------------------------------

# LW_PREVIEW_GOLDEN_SOURCE — team golden that preview VMs are forked from.
# Overridable so the user can swap to a personal lw-preview source without
# touching the Makefile.
LW_PREVIEW_GOLDEN_SOURCE="${LW_PREVIEW_GOLDEN_SOURCE:-langwatch-golden-v2}"

# boxd_preview_vm_name BRANCH — return the VM name for a preview fork.
# Pattern: preview-<slug(branch)>
boxd_preview_vm_name() {
  local branch="${1-}"
  [ -n "$branch" ] || { echo "boxd_preview_vm_name: BRANCH is required" >&2; return 1; }
  printf 'preview-%s' "$(boxd_slug "$branch")"
}

# boxd_preview_up BRANCH — fork the team golden, check out the branch inside
# the VM, then start the full compose stack (compose.dev.yml --profile full).
# Prints the VM URL on success.
#
# Does not upload Claude creds or .env files — preview VMs are read-only
# stack snapshots, not development environments.
boxd_preview_up() {
  local branch="${1-}"
  [ -n "$branch" ] || { echo "usage: make boxd-preview BRANCH=<name>" >&2; return 1; }
  if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
    echo "ERROR: '$branch' is not a valid git branch name." >&2
    return 1
  fi

  local vm golden q_branch q_origin_branch
  vm=$(boxd_preview_vm_name "$branch") || return 1
  golden="${LW_PREVIEW_GOLDEN_SOURCE}"

  printf 'Creating preview VM: %s (source=%s, branch=%s)\n' "$vm" "$golden" "$branch" >&2

  if boxd_vm_exists "$vm"; then
    cat <<EOF >&2
ERROR: VM '$vm' already exists. Destroy it first:
  make boxd-preview-down BRANCH=$branch
Or check its status:
  make boxd-preview-status BRANCH=$branch
EOF
    return 1
  fi

  if ! "$BOXD_BIN" fork "$golden" --name="$vm" >/dev/null; then
    cat <<EOF >&2
ERROR: 'boxd fork $golden --name=$vm' failed.
       Is '$golden' the correct team golden name? Override with:
         LW_PREVIEW_GOLDEN_SOURCE=<name> make boxd-preview BRANCH=$branch
EOF
    return 1
  fi

  # Check out the branch inside the VM. Wraps in bash -c so set -o pipefail
  # works (boxd exec runs /bin/sh / dash by default).
  q_branch=$(_boxd_shell_quote "$branch")
  q_origin_branch=$(_boxd_shell_quote "origin/$branch")
  if ! "$BOXD_BIN" exec "$vm" -- bash -c "
    set -euo pipefail
    cd langwatch
    git fetch origin
    git checkout $q_branch 2>/dev/null \
      || git checkout -b $q_branch $q_origin_branch 2>/dev/null \
      || git checkout $q_origin_branch
    git pull --ff-only origin $q_branch 2>/dev/null || true
  "; then
    echo "ERROR: failed to check out '$branch' inside $vm." >&2
    return 1
  fi

  # Start the full compose stack detached.
  if ! "$BOXD_BIN" exec "$vm" -- bash -c "
    set -euo pipefail
    cd langwatch
    docker compose -f compose.dev.yml --profile full up -d --build
  "; then
    echo "ERROR: 'docker compose up' failed inside $vm." >&2
    return 1
  fi

  printf 'Done.\n' >&2
  printf 'Preview URL: https://%s.boxd.sh\n' "$vm"
}

# boxd_preview_down BRANCH — destroy the preview VM non-interactively.
# Validates branch shape before slugging to a VM name; an invalid branch can
# otherwise slug to a *different* valid VM name and destroy the wrong one.
boxd_preview_down() {
  local branch="${1-}"
  [ -n "$branch" ] || { echo "usage: make boxd-preview-down BRANCH=<name>" >&2; return 1; }
  if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
    echo "ERROR: '$branch' is not a valid git branch name." >&2
    return 1
  fi

  local vm
  vm=$(boxd_preview_vm_name "$branch") || return 1

  if ! boxd_vm_exists "$vm"; then
    printf 'INFO: VM %s does not exist — nothing to destroy.\n' "$vm" >&2
    return 0
  fi

  printf 'Destroying preview VM: %s\n' "$vm" >&2
  if ! "$BOXD_BIN" destroy "$vm" -y >/dev/null 2>&1; then
    echo "ERROR: 'boxd destroy $vm -y' failed." >&2
    return 1
  fi
  printf 'Destroyed %s.\n' "$vm" >&2
}

# boxd_preview_status BRANCH — print VM status, in-VM git branch + HEAD sha,
# and docker compose ps output. Informational; never modifies state.
# Still validates branch shape so a typo doesn't report on the wrong VM.
boxd_preview_status() {
  local branch="${1-}"
  [ -n "$branch" ] || { echo "usage: make boxd-preview-status BRANCH=<name>" >&2; return 1; }
  if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
    echo "ERROR: '$branch' is not a valid git branch name." >&2
    return 1
  fi

  local vm
  vm=$(boxd_preview_vm_name "$branch") || return 1

  printf '==> VM: %s\n' "$vm"
  local status
  status=$(boxd_vm_status "$vm")
  printf '    status:  %s\n' "${status:-unknown}"

  if ! boxd_vm_exists "$vm"; then
    printf '    (VM does not exist)\n' >&2
    return 0
  fi

  boxd_wake_if_suspended "$vm"

  local git_info
  git_info=$("$BOXD_BIN" exec "$vm" -- bash -c "
    cd langwatch 2>/dev/null || exit 0
    printf 'branch: %s\n' \"\$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)\"
    printf 'sha:    %s\n' \"\$(git rev-parse HEAD 2>/dev/null || echo unknown)\"
  " 2>/dev/null || echo "(could not read git state)")
  printf '%s\n' "$git_info" | sed 's/^/    /'

  printf '==> docker compose ps:\n'
  "$BOXD_BIN" exec "$vm" -- bash -c "
    cd langwatch 2>/dev/null || exit 0
    docker compose -f compose.dev.yml --profile full ps 2>/dev/null || echo '(compose not running)'
  " 2>/dev/null | sed 's/^/    /' || true
}
