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
# to its directory, the way Mintlify serves it, and the root `index` page maps
# to `/`.
#
# For each page that exists at the base and no longer exists on the branch, the
# script asks docs/docs.json on the branch for a `redirects` entry with:
#   - `source` equal to `/<path>`, or a section wildcard `/<prefix>/:path*`
#     that covers it
#   - `destination` that is a page on the branch, an external https:// URL with
#     a host, or a wildcard pattern carried through from the source
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
import re
import sys
from urllib.parse import urlsplit


def canonical(path):
    """The path form used to report a removed page.

    An index page maps to its directory, and the root index page maps to the
    site root, which is the empty page path.
    """
    if path == "index":
        return ""
    if path.endswith("/index"):
        return path[: -len("/index")]
    return path


def page_paths(listing):
    """docs/**/*.mdx file list -> set of Mintlify page paths."""
    pages = set()
    for line in listing.splitlines():
        line = line.strip()
        if not line.endswith(".mdx") or not line.startswith("docs/"):
            continue
        path = line[len("docs/"):-len(".mdx")]
        pages.add(path)
        pages.add(canonical(path))
    return pages


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


# Mintlify redirect paths use path-to-regexp syntax: `:name` matches exactly
# one segment, and `:name*` matches zero or more, which is how a whole section
# moves (`/old/:path*`). Anything else in a segment is a literal.
PARAMETER = re.compile(r"^:([A-Za-z_][A-Za-z0-9_]*)(\*?)$")


def split_path(path):
    trimmed = path.strip("/")
    return trimmed.split("/") if trimmed else []


def parameter_names(path):
    """The names of the path parameters in a redirect source or destination."""
    names = []
    for segment in split_path(path):
        match = PARAMETER.match(segment)
        if match:
            names.append(match.group(1))
    return names


def compile_source(source):
    """A parameterised source -> (regex, literal prefix), or None if it is exact."""
    pattern = ""
    prefix = []
    captured = set()
    literal_so_far = True
    has_parameter = False
    for segment in split_path(source):
        match = PARAMETER.match(segment)
        if not match:
            if literal_so_far:
                prefix.append(segment)
            pattern += "/" + re.escape(segment)
            continue
        literal_so_far = False
        has_parameter = True
        name = match.group(1)
        # A repeated name cannot be substituted unambiguously, so capture the
        # first one only and let the destination check report the rest.
        group = f"?P<{name}>" if name not in captured else "?:"
        captured.add(name)
        # `:name*` spans the rest of the path, `:name` is one segment.
        if match.group(2):
            pattern += f"({group}(?:/[^/]+)*)"
        else:
            pattern += f"/({group}[^/]+)"
    if not has_parameter:
        return None
    return re.compile("^" + pattern + "/?$"), "/" + "/".join(prefix)


# Longest literal prefix first, so the most specific section wins.
wildcard_sources = []
for source in by_source:
    compiled = compile_source(source)
    if compiled is not None:
        regex, prefix = compiled
        wildcard_sources.append((source, regex, prefix))
wildcard_sources.sort(key=lambda item: len(item[2]), reverse=True)


def covering_source(url):
    """(source, captures) for the docs.json redirect that routes this page URL.

    The source is None when nothing routes it. The captures are the path
    segments the parameters matched, keyed by parameter name.
    """
    if url in by_source:
        return url, {}
    for source, regex, _prefix in wildcard_sources:
        match = regex.match(url)
        if match:
            captures = {
                name: value.strip("/")
                for name, value in match.groupdict().items()
                if value is not None
            }
            return source, captures
    return None, {}


def resolve_destination(destination, captures):
    """The concrete path a parameterised destination rewrites to, or None."""
    segments = []
    for segment in split_path(destination.split("?", 1)[0]):
        match = PARAMETER.match(segment)
        if not match:
            segments.append(segment)
            continue
        value = captures.get(match.group(1))
        if value is None:
            return None
        # A `:name*` capture spans several segments, and matches none when the
        # source is the section root itself.
        if value:
            segments.extend(value.split("/"))
    return "/".join(segments)


def destination_problem(destination, source, captures):
    """None when the destination is good, else the reason it is not."""
    if not isinstance(destination, str) or not destination:
        return "destination is missing"
    if "#" in destination:
        return f"destination '{destination}' carries an #anchor"
    if destination.startswith("https://"):
        if not urlsplit(destination).netloc:
            return f"destination '{destination}' has no host"
        return None
    if destination.startswith("http://"):
        return f"destination '{destination}' is not https"
    if not destination.startswith("/"):
        return f"destination '{destination}' is not a path"
    # A section redirect carries the parameter through to the destination,
    # `/old/:path*` -> `/new/:path*`. The source has to capture every parameter
    # the destination substitutes, and the page the substitution lands on has
    # to exist, the same as for a destination with no parameter at all.
    if parameter_names(destination):
        missing = [
            name for name in parameter_names(destination) if name not in captures
        ]
        if missing:
            return (
                f"destination '{destination}' uses ':{missing[0]}', which "
                f"source '{source}' does not capture"
            )
        target = resolve_destination(destination, captures)
        if target is None:
            return f"destination '{destination}' cannot be resolved from '{source}'"
        if target in branch_pages:
            return None
        return (
            f"destination '{destination}' resolves to '/{target}', "
            f"which is not a page on {branch}"
        )
    target = destination.split("?", 1)[0].rstrip("/").lstrip("/")
    if target in branch_pages:
        return None
    return f"destination '/{target}' is not a page on {branch}"


gaps = []
for path in removed:
    url = f"/{path}"
    source, captures = covering_source(url)
    if source is None:
        # A near miss is worth naming: the ledger may hold the /index form.
        alt = f"{url.rstrip('/')}/index"
        if alt in by_source:
            gaps.append(
                f"{url}: no redirect (docs.json has '{alt}' instead, "
                f"which is not the page URL)"
            )
        else:
            gaps.append(f"{url}: page removed on {branch}, no redirect in docs.json")
        continue
    problem = destination_problem(by_source[source], source, captures)
    if problem:
        via = "" if source == url else f" (via '{source}')"
        gaps.append(f"{url}{via}: {problem}")

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
