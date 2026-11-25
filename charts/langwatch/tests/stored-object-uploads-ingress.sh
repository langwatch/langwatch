#!/usr/bin/env bash
#
# Renders the umbrella chart and asserts how uploads through LangWatch are
# carried (issue #9666, modules/stored-object/specs/uploads-through-langwatch.feature):
#
#   - app.dataplane.uploads reaches the app and the workers as STORED_OBJECTS_UPLOADS,
#     and nothing is set without it.
#   - an nginx app Ingress gets a second Ingress for /api/stored-objects/uploads
#     sized for files (body limit, no request buffering, long timeouts), and the
#     app Ingress keeps its own settings.
#
# Each test that binds to a feature scenario carries a "# @scenario \"...\"" line.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/stored-object-uploads-ingress.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
tmp="${TMPDIR:-/tmp}/lw-stored-object-uploads-ingress.$$"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

ok() {
  echo "ok   [$1] $2"
}

# Renders into $tmp/<name>.yaml, errors into $tmp/<name>.err. Never fails the
# script: the caller asserts on the files.
render() {
  local name="$1"
  shift
  helm template lw . --set autogen.enabled=true "$@" >"$tmp/$name.yaml" 2>"$tmp/$name.err" || true
}

# Every plain `value:` of `- name: <var>` in one template's rendered documents.
env_in() {
  local name="$1" source="$2" var="$3"
  awk -v src="langwatch/templates/$source" -v v="$var" '
    /^# Source:/ { insrc = (index($0, src) > 0); found=0 }
    insrc && $0 ~ "- name: " v "$" { found=1; next }
    insrc && /^[[:space:]]*- name:[[:space:]]/ { found=0 }
    found && /^[[:space:]]*value:[[:space:]]/ {
      sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; found=0
    }
  ' "$tmp/$name.yaml"
}

# One rendered document, picked by its metadata.name.
doc_named() {
  local name="$1" want="$2"
  awk -v want="  name: $want" '
    /^---/ { if (hit) exit; buf=""; next }
    { buf = buf $0 "\n" }
    $0 == want { hit=1 }
    END { if (hit) printf "%s", buf }
  ' "$tmp/$name.yaml"
}

DATAPLANE=(--set app.dataplane.enabled=true --set app.storedObjects.localFilesystem.enabled=false
  --set app.dataplane.providers.awsS3.endpoint.value=http://s3.managed.svc.cluster.local:9000)

# @scenario "The chart passes the upload setting to the app and the workers"
test_upload_setting_reaches_app_and_workers() {
  local component value
  render through "${DATAPLANE[@]}" --set app.dataplane.uploads=through-langwatch
  if [ -s "$tmp/through.err" ]; then
    fail "through render" "$(cat "$tmp/through.err")"
    return
  fi
  for component in app/deployment.yaml workers/deployment.yaml; do
    value=$(env_in through "$component" STORED_OBJECTS_UPLOADS | sort -u)
    if [ "$value" = "through-langwatch" ]; then
      ok "uploads env $component" "STORED_OBJECTS_UPLOADS=through-langwatch"
    else
      fail "uploads env $component" "STORED_OBJECTS_UPLOADS is '${value:-<unset>}', want through-langwatch"
    fi
  done

  render unset "${DATAPLANE[@]}"
  if [ -s "$tmp/unset.err" ]; then
    fail "unset render" "$(cat "$tmp/unset.err")"
  elif grep -q 'name: STORED_OBJECTS_UPLOADS$' "$tmp/unset.yaml"; then
    fail "uploads env unset" "STORED_OBJECTS_UPLOADS is set without app.dataplane.uploads"
  else
    ok "uploads env unset" "no STORED_OBJECTS_UPLOADS without app.dataplane.uploads"
  fi

  render sideways "${DATAPLANE[@]}" --set app.dataplane.uploads=sideways
  if grep -q 'app.dataplane.uploads is "sideways"' "$tmp/sideways.err"; then
    ok "uploads env unknown" "an unknown value is refused, naming app.dataplane.uploads"
  else
    fail "uploads env unknown" "app.dataplane.uploads=sideways rendered: $(cat "$tmp/sideways.err")"
  fi
}

# The app Ingress on, with two hosts.
APP_INGRESS=(--set ingress.enabled=true
  --set 'ingress.hosts[0].host=langwatch.acme.com'
  --set 'ingress.hosts[0].http.paths[0].path=/' --set 'ingress.hosts[0].http.paths[0].pathType=Prefix'
  --set 'ingress.hosts[1].host=langwatch.internal.acme.com'
  --set 'ingress.hosts[1].http.paths[0].path=/' --set 'ingress.hosts[1].http.paths[0].pathType=Prefix')

# @scenario "An nginx install routes LangWatch's upload route through its own Ingress"
test_nginx_upload_route_has_its_own_ingress() {
  local doc app host
  render nginx "${APP_INGRESS[@]}" --set ingress.className=nginx \
    --set-string 'ingress.annotations.cert-manager\.io/cluster-issuer=letsencrypt-prod' \
    --set 'ingress.tls[0].secretName=langwatch-tls' --set 'ingress.tls[0].hosts[0]=langwatch.acme.com' \
    --set-string 'ingress.annotations.nginx\.ingress\.kubernetes\.io/proxy-body-size=50m' \
    --set-string 'ingress.annotations.nginx\.ingress\.kubernetes\.io/rewrite-target=/$2' \
    --set-string 'ingress.annotations.nginx\.ingress\.kubernetes\.io/server-snippet=return 418;' \
    --set-string 'ingress.annotations.nginx\.ingress\.kubernetes\.io/configuration-snippet=more_set_headers "X-A: b";' \
    --set-string 'ingress.uploads.annotations.nginx\.ingress\.kubernetes\.io/proxy-read-timeout=7200'
  doc=$(doc_named nginx lw-uploads-ingress)
  app=$(doc_named nginx lw-ingress)
  if [ -z "$doc" ]; then
    fail "uploads ingress" "no lw-uploads-ingress rendered: $(cat "$tmp/nginx.err")"
    return
  fi
  for host in langwatch.acme.com langwatch.internal.acme.com; do
    if printf '%s\n' "$doc" | grep -q "host: \"$host\"$"; then
      ok "uploads host $host" "the upload route is on app host $host"
    else
      fail "uploads host $host" "the uploads Ingress does not carry app host $host"
    fi
  done
  if [ "$(printf '%s\n' "$doc" | grep -c 'path: /api/stored-objects/uploads$')" = "2" ] \
      && [ "$(printf '%s\n' "$doc" | grep -c 'pathType: Prefix$')" = "2" ] \
      && [ "$(printf '%s\n' "$doc" | grep -A2 'service:$' | grep -c 'name: lw-app$')" = "2" ]; then
    ok "uploads backend" "/api/stored-objects/uploads (Prefix, no trailing slash: nginx would 301 the create route) routes to the lw-app Service"
  else
    fail "uploads backend" "the upload path does not route to lw-app as a Prefix"
  fi
  if printf '%s\n' "$doc" | grep -q 'ingressClassName: nginx$'; then
    ok "uploads class" "ingressClassName: nginx"
  else
    fail "uploads class" "the uploads Ingress is not class nginx"
  fi
  if printf '%s\n' "$doc" | grep -q 'proxy-request-buffering: "off"' \
      && printf '%s\n' "$doc" | grep -q 'proxy-body-size: 5121m' \
      && printf '%s\n' "$doc" | grep -q 'proxy-send-timeout: "3600"'; then
    ok "uploads nginx" "request buffering off, 5121m body, 3600s send timeout"
  else
    fail "uploads nginx" "the uploads Ingress is missing the nginx upload settings"
  fi
  if printf '%s\n' "$doc" | grep -q 'proxy-read-timeout: "7200"'; then
    ok "uploads override" "ingress.uploads.annotations wins"
  else
    fail "uploads override" "ingress.uploads.annotations did not override the nginx default"
  fi
  if printf '%s\n' "$doc" | grep -q 'cert-manager.io/cluster-issuer: letsencrypt-prod'; then
    ok "uploads inherits" "carries the app Ingress annotations"
  else
    fail "uploads inherits" "the app Ingress annotations did not reach the uploads Ingress"
  fi
  if printf '%s\n' "$doc" | grep -q 'server-snippet'; then
    fail "uploads no server-snippet" "the uploads Ingress copied the host-scoped server-snippet, which nginx would apply twice"
  elif printf '%s\n' "$app" | grep -q 'server-snippet'; then
    ok "uploads no server-snippet" "the server-snippet stays on the app Ingress only"
  else
    fail "uploads no server-snippet" "the app Ingress lost its server-snippet"
  fi
  if printf '%s\n' "$doc" | grep -q 'configuration-snippet: .*more_set_headers "X-A: b";' \
      && printf '%s\n' "$app" | grep -q 'configuration-snippet'; then
    ok "uploads configuration-snippet" "the location-scoped configuration-snippet also guards the upload route"
  else
    fail "uploads configuration-snippet" "the uploads Ingress dropped the app configuration-snippet, so uploads would bypass it"
  fi
  if printf '%s\n' "$doc" | grep -q 'rewrite-target\|^  tls:'; then
    fail "uploads no rewrite or tls" "the uploads Ingress inherited a rewrite-target or a tls entry"
  else
    ok "uploads no rewrite or tls" "no rewrite-target and no second tls entry"
  fi
  if printf '%s\n' "$app" | grep -q 'proxy-body-size: 50m' && printf '%s\n' "$app" | grep -q 'proxy-read-timeout: "120"' \
      && printf '%s\n' "$app" | grep -q 'rewrite-target' && printf '%s\n' "$app" | grep -q 'secretName: langwatch-tls$' \
      && ! printf '%s\n' "$app" | grep -q 'proxy-request-buffering'; then
    ok "app untouched" "the app Ingress keeps its own settings"
  else
    fail "app untouched" "the app Ingress lost its settings or took the upload ones"
  fi

  render envoy "${APP_INGRESS[@]}" --set ingress.className=envoy
  if [ -s "$tmp/envoy.err" ]; then
    fail "envoy render" "$(cat "$tmp/envoy.err")"
  elif grep -q 'lw-uploads-ingress' "$tmp/envoy.yaml"; then
    fail "envoy uploads" "a non-nginx class got an uploads Ingress"
  else
    ok "envoy uploads" "other classes route uploads on the app Ingress, with no second Ingress"
  fi

  render blocked "${APP_INGRESS[@]}" --set ingress.className=nginx --set-json 'ingress.blockedPaths=["/api/stored-objects"]'
  if [ -s "$tmp/blocked.err" ] || ! grep -q 'name: lw-ingress$' "$tmp/blocked.yaml"; then
    fail "blocked render" "the app Ingress did not render: $(cat "$tmp/blocked.err")"
  elif grep -q 'lw-uploads-ingress' "$tmp/blocked.yaml"; then
    fail "blocked uploads" "a blocked prefix over the upload route still rendered an uploads Ingress"
  else
    ok "blocked uploads" "a blocked prefix over the upload route wins"
  fi

  render default
  if grep -q 'lw-uploads-ingress' "$tmp/default.yaml"; then
    fail "default uploads" "a default install renders an uploads Ingress"
  else
    ok "default uploads" "no uploads Ingress without the app Ingress"
  fi
}

# @scenario "An nginx install routes LangWatch's upload route through its own Ingress"
test_uploads_ingress_switch() {
  local doc
  render forced "${APP_INGRESS[@]}" --set ingress.uploads.enabled=true
  doc=$(doc_named forced lw-uploads-ingress)
  if [ -z "$doc" ]; then
    fail "forced default class" "ingress.uploads.enabled=true with no className rendered no uploads Ingress: $(cat "$tmp/forced.err")"
  elif printf '%s\n' "$doc" | grep -q 'ingressClassName\|nginx.ingress.kubernetes.io'; then
    fail "forced default class" "an empty className got a class or guessed nginx annotations"
  else
    ok "forced default class" "rendered on the default class, with no guessed nginx annotations"
  fi

  render forced-own "${APP_INGRESS[@]}" --set ingress.uploads.enabled=true \
    --set-string 'ingress.uploads.annotations.nginx\.ingress\.kubernetes\.io/proxy-body-size=6g'
  if doc_named forced-own lw-uploads-ingress | grep -q 'proxy-body-size: 6g$'; then
    ok "forced own annotations" "ingress.uploads.annotations apply on a forced Ingress"
  else
    fail "forced own annotations" "ingress.uploads.annotations missing on a forced Ingress"
  fi

  render internal "${APP_INGRESS[@]}" --set ingress.className=nginx-internal --set ingress.uploads.enabled=true
  doc=$(doc_named internal lw-uploads-ingress)
  if printf '%s\n' "$doc" | grep -q 'ingressClassName: nginx-internal$' && printf '%s\n' "$doc" | grep -q 'proxy-body-size: 5121m'; then
    ok "forced nginx-internal" "an nginx-named class gets the upload settings"
  else
    fail "forced nginx-internal" "nginx-internal did not get its class and the upload settings: $(cat "$tmp/internal.err")"
  fi
  render internal-auto "${APP_INGRESS[@]}" --set ingress.className=nginx-internal
  if grep -q 'lw-uploads-ingress' "$tmp/internal-auto.yaml"; then
    fail "auto nginx-internal" "auto mode rendered for a class other than nginx"
  else
    ok "auto nginx-internal" "auto mode is on for className nginx only"
  fi

  render off "${APP_INGRESS[@]}" --set ingress.className=nginx --set ingress.uploads.enabled=false
  if [ -s "$tmp/off.err" ] || ! grep -q 'name: lw-ingress$' "$tmp/off.yaml"; then
    fail "nginx off" "the render failed: $(cat "$tmp/off.err")"
  elif grep -q 'lw-uploads-ingress' "$tmp/off.yaml"; then
    fail "nginx off" "ingress.uploads.enabled=false still rendered an uploads Ingress"
  else
    ok "nginx off" "ingress.uploads.enabled=false turns it off on nginx"
  fi

  render orphan --set ingress.uploads.enabled=true
  if grep -q 'ingress.uploads.enabled is true but ingress.enabled is not true' "$tmp/orphan.err"; then
    ok "forced without ingress" "refused, naming ingress.enabled"
  else
    fail "forced without ingress" "ingress.uploads.enabled=true without ingress.enabled rendered: $(cat "$tmp/orphan.err")"
  fi
}

# @scenario "An nginx install routes LangWatch's upload route through its own Ingress"
test_operator_owned_upload_path() {
  local spelling doc
  for spelling in /api/stored-objects/uploads /api/stored-objects/uploads/; do
    render owned --set ingress.enabled=true --set ingress.className=nginx \
      --set 'ingress.hosts[0].host=langwatch.acme.com' \
      --set 'ingress.hosts[0].http.paths[0].path=/' --set 'ingress.hosts[0].http.paths[0].pathType=Prefix' \
      --set "ingress.hosts[0].http.paths[1].path=$spelling" --set 'ingress.hosts[0].http.paths[1].pathType=Prefix'
    if [ -s "$tmp/owned.err" ] || ! grep -q 'name: lw-ingress$' "$tmp/owned.yaml"; then
      fail "operator path $spelling" "the render failed: $(cat "$tmp/owned.err")"
    elif grep -q 'lw-uploads-ingress' "$tmp/owned.yaml"; then
      fail "operator path $spelling" "the uploads Ingress repeats a path the operator routes, which ingress-nginx admission rejects"
    else
      ok "operator path $spelling" "the operator's own route wins; no uploads Ingress"
    fi
  done

  render descendant --set ingress.enabled=true --set ingress.className=nginx \
    --set 'ingress.hosts[0].host=langwatch.acme.com' \
    --set 'ingress.hosts[0].http.paths[0].path=/' --set 'ingress.hosts[0].http.paths[0].pathType=Prefix' \
    --set 'ingress.hosts[0].http.paths[1].path=/api/stored-objects/uploads/content' --set 'ingress.hosts[0].http.paths[1].pathType=Prefix'
  doc=$(doc_named descendant lw-uploads-ingress)
  if printf '%s\n' "$doc" | grep -q 'host: "langwatch.acme.com"$' && printf '%s\n' "$doc" | grep -q 'path: /api/stored-objects/uploads$'; then
    ok "operator descendant path" "a longer operator path keeps the parent upload route, so other upload ids do not fall to /"
  else
    fail "operator descendant path" "an operator path under the upload route dropped the host: $(cat "$tmp/descendant.err")"
  fi

  render owned-one "${APP_INGRESS[@]}" --set ingress.className=nginx \
    --set 'ingress.hosts[1].http.paths[1].path=/api/stored-objects/uploads/' --set 'ingress.hosts[1].http.paths[1].pathType=Prefix'
  doc=$(doc_named owned-one lw-uploads-ingress)
  if printf '%s\n' "$doc" | grep -q 'host: "langwatch.acme.com"$' && ! printf '%s\n' "$doc" | grep -q 'langwatch.internal.acme.com'; then
    ok "operator path one host" "only the host that routes the path itself is left out"
  else
    fail "operator path one host" "the uploads Ingress did not leave out just the operator's host: $(cat "$tmp/owned-one.err")"
  fi
}

test_upload_setting_reaches_app_and_workers
test_nginx_upload_route_has_its_own_ingress
test_operator_owned_upload_path
test_uploads_ingress_switch

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all stored-object upload chart assertions passed"
