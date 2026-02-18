#!/bin/bash
# Create a git worktree from an issue number or feature name.
# Usage: scripts/worktree.sh <issue-number|feature-name>
set -euo pipefail

REPO="langwatch/langwatch"

# --- Pure functions (testable) ---

# Generate a URL-safe slug from a title string.
# Lowercases, replaces non-alphanumeric with hyphens, collapses runs,
# strips leading/trailing hyphens, truncates long slugs at word boundary.
generate_slug() {
  local title="$1"
  local slug

  # Lowercase, replace non-alphanumeric with hyphens, collapse runs, trim edges
  slug=$(printf '%s' "$title" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]/-/g' \
    | sed 's/-\{2,\}/-/g' \
    | sed 's/^-//;s/-$//')

  # Truncate at word (hyphen) boundary when slug exceeds limit.
  # Limit is 50 to accommodate typical issue titles while still
  # trimming very long ones at a word boundary.
  local max_len=50
  if [ "${#slug}" -gt "$max_len" ]; then
    slug="${slug:0:$max_len}"
    # Cut back to last hyphen to avoid partial words
    if [[ "$slug" == *-* ]]; then
      slug="${slug%-*}"
    fi
  fi

  # Strip any trailing hyphen (safety net)
  slug="${slug%-}"

  printf '%s' "$slug"
}

# Build branch name from issue number + slug, or feature name.
build_branch_name() {
  local input="$1"
  local slug="${2:-}"

  if [[ "$input" =~ ^[0-9]+$ ]]; then
    printf 'issue%s/%s' "$input" "$slug"
  else
    printf 'feat/%s' "$input"
  fi
}

# Derive the worktree directory from a branch name.
# Replaces / with - and prepends .worktrees/
derive_directory() {
  local branch="$1"
  printf '.worktrees/%s' "${branch//\//-}"
}

# --- Orchestration (side-effecting) ---

main() {
  if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
    echo "Usage: scripts/worktree.sh <issue-number|feature-name>" >&2
    exit 1
  fi

  # Guard against running from inside a worktree (would nest worktrees)
  local git_common_dir
  git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
  local git_dir
  git_dir=$(git rev-parse --git-dir 2>/dev/null)
  if [ "$git_common_dir" != "$git_dir" ]; then
    echo "Error: You're inside a worktree. Run this script from the main repo checkout instead." >&2
    exit 1
  fi

  local input="$1"
  local branch=""
  local issue_url=""

  # Determine if input is an issue number or feature name
  if [[ "$input" =~ ^[0-9]+$ ]]; then
    # Issue number: need gh CLI
    if ! command -v gh &>/dev/null; then
      echo "Error: gh CLI is required for issue-based worktrees. Install from https://cli.github.com/" >&2
      exit 1
    fi

    local title
    title=$(gh issue view "$input" --repo "$REPO" --json title --jq '.title')
    local slug
    slug=$(generate_slug "$title")
    branch=$(build_branch_name "$input" "$slug")
    issue_url="https://github.com/${REPO}/issues/${input}"
  else
    branch=$(build_branch_name "$input")
  fi

  local dir
  dir=$(derive_directory "$branch")
  local abs_dir
  abs_dir="$(pwd)/${dir}"

  # Check if directory already exists
  if [ -d "$dir" ]; then
    echo "Error: Worktree directory already exists: ${abs_dir}" >&2
    exit 1
  fi

  # Fetch latest from origin
  git fetch origin

  # Check if branch exists remotely
  if git ls-remote --exit-code --heads origin "$branch" &>/dev/null; then
    # Track existing remote branch
    git worktree add "$dir" "$branch"
  else
    # Create new branch from origin/main
    git worktree add -b "$branch" "$dir" origin/main
  fi

  # Copy .env files from repo root and subdirectories that need them
  for src_dir in "." "langwatch" "langwatch_nlp"; do
    local dest="${dir}"
    [ "$src_dir" != "." ] && dest="${dir}/${src_dir}"
    for f in "${src_dir}"/.env*; do
      [ -f "$f" ] || continue
      cp "$f" "${dest}/"
    done
  done

  # Install dependencies
  echo ""
  echo "Installing dependencies..."
  (cd "$dir" && pnpm install)

  # Print summary
  echo ""
  echo "Worktree created:"
  echo "  Branch: ${branch}"
  echo "  Path:   ${abs_dir}"
  if [ -n "$issue_url" ]; then
    echo "  Issue:  ${issue_url}"
  fi

  # Open a new shell in the worktree directory
  echo ""
  echo "Opening shell in worktree..."
  cd "$abs_dir" && exec "$SHELL"
}

# Only run main when executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
