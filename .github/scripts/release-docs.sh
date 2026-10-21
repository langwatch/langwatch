#!/usr/bin/env bash
# Busts the docs site cache: rewrites the one /ci/cache/busted/* redirect in
# docs/docs.json and pushes that commit to main. Main moves while this runs, so
# each attempt starts from the newest main rather than the commit checked out.
# Usage: release-docs.sh <reason>   Spec: specs/ci/docs-release.feature
set -euo pipefail

reason=$1
attempts=${RELEASE_DOCS_ATTEMPTS:-5}
delay=${RELEASE_DOCS_RETRY_SECONDS:-5}
root=$(git rev-parse --show-toplevel)

bust_cache() {
  jq --arg now "$(date +%s)" \
    '([.redirects[] | select(.source | startswith("/ci/cache/busted/"))] | length) as $n
    | if $n == 1 then
        .redirects |= map(
          if (.source | startswith("/ci/cache/busted/"))
          then .source = ("/ci/cache/busted/" + $now)
          else . end)
      else
        error("expected exactly one redirect with source /ci/cache/busted/*, found \($n)")
      end' \
    "$root/docs/docs.json" >"$root/docs/docs.json.tmp"
  mv "$root/docs/docs.json.tmp" "$root/docs/docs.json"
}

for attempt in $(seq 1 "$attempts"); do
  git -C "$root" fetch -q origin main
  git -C "$root" reset -q --hard origin/main
  bust_cache
  git -C "$root" add docs/docs.json
  git -C "$root" commit -q -m "Release docs ($reason) [skip ci]"
  if git -C "$root" push -q origin HEAD:main; then
    echo "Docs released on attempt $attempt."
    exit 0
  fi
  sleep $((attempt * delay))
done
echo "::error::main kept moving; the docs release was not pushed after $attempts attempts."
exit 1
