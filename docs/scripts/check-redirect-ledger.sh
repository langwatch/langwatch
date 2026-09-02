#!/usr/bin/env bash
#
# check-redirect-ledger.sh - every docs page removed or renamed on a branch must
# have a redirect in docs/docs.json.
#
# Usage:
#   bash docs/scripts/check-redirect-ledger.sh <branch> [base]
#
# Examples:
#   bash docs/scripts/check-redirect-ledger.sh origin/docs/gateway-core
#   bash docs/scripts/check-redirect-ledger.sh origin/main f3aad4edfb
#
# The branch and the base are read with `git show` / `git ls-tree`, so the
# working tree is not touched and a remote branch works right after
# `git fetch origin <branch>`.
#
# A page path has no `docs/` prefix and no `.mdx` suffix. An `index` page maps
# to its directory, the way Mintlify serves it.
#
# For each page that exists at the base and no longer exists on the branch, the
# script asks docs/docs.json on the branch for a `redirects` entry with:
#   - `source` equal to `/<path>`
#   - `destination` that is a page on the branch, or an external https:// URL
#   - no `#anchor` in the destination
#
# Exit code is 1 when there is at least one gap, 0 otherwise.

set -euo pipefail

BRANCH="${1:-}"
BASE="${2:-f3aad4edfb}"

if [ -z "$BRANCH" ]; then
  echo "usage: bash docs/scripts/check-redirect-ledger.sh <branch> [base]" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

for ref in "$BRANCH" "$BASE"; do
  if ! git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null; then
    echo "error: cannot resolve ref '${ref}'. Run: git fetch origin <branch>" >&2
    exit 2
  fi
done

BASE_FILES="$(git ls-tree -r --name-only "$BASE" docs/ || true)"
BRANCH_FILES="$(git ls-tree -r --name-only "$BRANCH" docs/ || true)"

if git cat-file -e "${BRANCH}:docs/docs.json" 2>/dev/null; then
  DOCS_JSON="$(git show "${BRANCH}:docs/docs.json")"
else
  DOCS_JSON=""
fi

export BRANCH_NAME="$BRANCH"
export BASE_NAME="$BASE"
export BASE_FILES BRANCH_FILES DOCS_JSON

python3 - <<'PY_EOF'
import json
import os
import sys


def page_paths(listing):
    """docs/**/*.mdx file list -> set of Mintlify page paths."""
    pages = set()
    for line in listing.splitlines():
        line = line.strip()
        if not line.endswith(".mdx") or not line.startswith("docs/"):
            continue
        path = line[len("docs/"):-len(".mdx")]
        pages.add(path)
        if path.endswith("/index"):
            pages.add(path[: -len("/index")])
    return pages


def canonical(path):
    """The path form used to report a removed page."""
    if path.endswith("/index"):
        return path[: -len("/index")]
    return path


branch = os.environ["BRANCH_NAME"]
base = os.environ["BASE_NAME"]
docs_json_text = os.environ["DOCS_JSON"]

base_pages = page_paths(os.environ["BASE_FILES"])
branch_pages = page_paths(os.environ["BRANCH_FILES"])

# Report one line per removed page, in canonical (index -> directory) form.
removed = sorted({canonical(p) for p in base_pages - branch_pages})

if docs_json_text.strip():
    try:
        docs_json = json.loads(docs_json_text)
    except json.JSONDecodeError as exc:
        print(f"error: docs/docs.json on {branch} is not valid JSON: {exc}")
        sys.exit(1)
else:
    docs_json = {}

redirects = docs_json.get("redirects") or []
by_source = {}
for entry in redirects:
    if not isinstance(entry, dict):
        continue
    source = entry.get("source")
    if isinstance(source, str):
        by_source.setdefault(source, entry.get("destination"))


def destination_problem(destination):
    """None when the destination is good, else the reason it is not."""
    if not isinstance(destination, str) or not destination:
        return "destination is missing"
    if destination.startswith("https://"):
        return None
    if destination.startswith("http://"):
        return f"destination '{destination}' is not https"
    if "#" in destination:
        return f"destination '{destination}' carries an #anchor"
    if not destination.startswith("/"):
        return f"destination '{destination}' is not a path"
    target = destination.split("?", 1)[0].rstrip("/").lstrip("/")
    if target in branch_pages:
        return None
    return f"destination '/{target}' is not a page on {branch}"


gaps = []
for path in removed:
    source = f"/{path}"
    if source not in by_source:
        # A near miss is worth naming: the ledger may hold the /index form.
        alt = f"/{path}/index"
        if alt in by_source:
            gaps.append(
                f"{source}: no redirect (docs.json has '{alt}' instead, "
                f"which is not the page URL)"
            )
        else:
            gaps.append(f"{source}: page removed on {branch}, no redirect in docs.json")
        continue
    problem = destination_problem(by_source[source])
    if problem:
        gaps.append(f"{source}: {problem}")

print(f"branch:  {branch}")
print(f"base:    {base}")
print(f"pages:   {len(base_pages)} at base, {len(branch_pages)} on branch")
print(f"removed: {len(removed)}")
print(f"redirects in docs.json: {len(by_source)}")

if gaps:
    print("")
    for gap in gaps:
        print(f"GAP {gap}")
    print("")
    print(f"{len(gaps)} redirect gap(s) on {branch}")
    sys.exit(1)

print("")
if removed:
    print(f"OK: all {len(removed)} removed page(s) have a redirect to a page that exists")
else:
    print("OK: no pages were removed")
sys.exit(0)
PY_EOF
