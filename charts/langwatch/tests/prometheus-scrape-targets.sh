#!/usr/bin/env bash
#
# Renders the chart and asserts which pods each bundled Prometheus scrape job
# selects, and that the pods carry what the jobs select on.
#
# The app serves /metrics on 5560 and the workers on 2999. Both jobs discover
# every pod in the namespace, so a job that keeps on the scrape annotation
# alone also keeps the other workload's pods and dials them on a port they do
# not listen on. And a workload whose pods lack the annotation is dropped by
# its own job: the queue backlog gauges live on the workers, so that is the
# backlog alert going silent. Both are relabeling rules against pod metadata,
# visible only in the render.
#
# Each test carries a plain "# Verifies:" line naming what it pins.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/prometheus-scrape-targets.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

render_to() {
  local out="$1" err="$2" release="$3"
  shift 3
  local status
  helm template "$release" . "$@" >"$out" 2>"$err" && status=0 || status=$?
  return $status
}

# One template's rendered Source block. $2 is the template path fragment.
source_block() {
  awk -v want="$2" '
    /^# Source:/ { insrc = (index($0, want) > 0) }
    insrc { print }
  ' "$1"
}

# The pod template's annotations in a Deployment block read on stdin: the
# `annotations:` under `template:`, up to the pod `spec:`.
pod_annotations() {
  awk '
    /^  template:/ { intemplate = 1 }
    intemplate && /^      annotations:/ { inann = 1; next }
    intemplate && /^    spec:/ { exit }
    inann { sub(/^[[:space:]]*/, ""); print }
  '
}

# The pod template's app.kubernetes.io/name label in a Deployment block.
pod_name_label() {
  awk '
    /^  template:/ { intemplate = 1 }
    intemplate && /app.kubernetes.io\/name:/ { print $2; exit }
  '
}

# One scrape job's lines from the rendered Prometheus config. $2 is the job.
scrape_job() {
  awk -v want="- job_name: '$2'" '
    /- job_name:/ { injob = (index($0, want) > 0) }
    injob { print }
  ' "$1"
}

# The regex of the `keep` rule a job applies to one source label, read from a
# job block on stdin.
keep_regex_for() {
  awk -v label="$1" '
    /- source_labels:/ { matched = (index($0, "[" label "]") > 0) }
    matched && /action:/ && !/keep/ { matched = 0 }
    matched && /regex:/ { print $2; exit }
  '
}

NAME_LABEL="__meta_kubernetes_pod_label_app_kubernetes_io_name"
SCRAPE_ANNOTATION="__meta_kubernetes_pod_annotation_prometheus_io_scrape"
METRICS_ON=(
  --set autogen.enabled=true
  --set app.telemetry.metrics.enabled=true
  --set app.telemetry.metrics.apiKey.value=scrape-token
)

# Verifies: with metrics on, the workers pods carry the scrape annotation and
# their metrics port, and the app pods keep theirs
test_pods_carry_scrape_annotations() {
  local out="${TMPDIR:-/tmp}/prom-on.yaml" err="${TMPDIR:-/tmp}/prom-on.err"
  if ! render_to "$out" "$err" t "${METRICS_ON[@]}"; then
    fail "on-render" "render with metrics on failed:
$(cat "$err")"
    return
  fi

  local pair workload port annotations
  for pair in "workers/deployment.yaml=2999" "app/deployment.yaml=5560"; do
    workload="${pair%%=*}"
    port="${pair#*=}"
    annotations="$(source_block "$out" "$workload" | pod_annotations)"
    if ! grep -qxF 'prometheus.io/scrape: "true"' <<<"$annotations"; then
      fail "annotation-scrape-$workload" \
        "$workload pods do not carry prometheus.io/scrape: \"true\" with metrics on, so their scrape job drops them. Pod annotations rendered:
${annotations:-<none>}"
    fi
    if ! grep -qxF "prometheus.io/port: \"$port\"" <<<"$annotations"; then
      fail "annotation-port-$workload" \
        "$workload pods do not carry prometheus.io/port: \"$port\". An external Prometheus reads the port from it. Pod annotations rendered:
${annotations:-<none>}"
    fi
  done
}

# Verifies: with metrics off, neither workload's pods are annotated for scraping
test_no_annotations_when_metrics_off() {
  local out="${TMPDIR:-/tmp}/prom-off.yaml" err="${TMPDIR:-/tmp}/prom-off.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "off-render" "default render failed:
$(cat "$err")"
    return
  fi

  local workload annotations
  for workload in "workers/deployment.yaml" "app/deployment.yaml"; do
    annotations="$(source_block "$out" "$workload" | pod_annotations)"
    if grep -q 'prometheus.io/' <<<"$annotations"; then
      fail "off-annotated-$workload" \
        "$workload pods carry a prometheus.io annotation with metrics off. Nothing serves /metrics then, so every scrape of them fails."
    fi
  done
}

# Verifies: each job keeps only its own workload's pods, on that workload's port
test_each_job_selects_its_own_pods() {
  local out="${TMPDIR:-/tmp}/prom-jobs.yaml" err="${TMPDIR:-/tmp}/prom-jobs.err"
  if ! render_to "$out" "$err" t "${METRICS_ON[@]}"; then
    fail "jobs-render" "render with metrics on failed:
$(cat "$err")"
    return
  fi

  local triple job workload port block label keep
  for triple in "langwatch=app/deployment.yaml=5560" \
                "langwatch-workers=workers/deployment.yaml=2999"; do
    job="${triple%%=*}"
    workload="${triple#*=}"
    workload="${workload%%=*}"
    port="${triple##*=}"
    block="$(scrape_job "$out" "$job")"
    if [[ -z "$block" ]]; then
      fail "job-missing-$job" "the rendered Prometheus config has no '$job' scrape job."
      continue
    fi

    label="$(source_block "$out" "$workload" | pod_name_label)"
    keep="$(keep_regex_for "$NAME_LABEL" <<<"$block")"
    if [[ -z "$label" || "$keep" != "$label" ]]; then
      fail "job-selector-$job" \
        "job '$job' keeps pods whose app.kubernetes.io/name is '${keep:-<any>}', but the $workload pods are labelled '${label:-<none>}'. A job that does not keep on its own workload's label scrapes the other workload's pods on the wrong port."
    fi
    if [[ "$(keep_regex_for "$SCRAPE_ANNOTATION" <<<"$block")" != "true" ]]; then
      fail "job-annotation-$job" \
        "job '$job' does not keep on the prometheus.io/scrape annotation, so it scrapes pods while metrics are off."
    fi
    if ! grep -qF "replacement: \$1:$port" <<<"$block"; then
      fail "job-port-$job" "job '$job' does not dial port $port."
    fi
    if ! grep -qxF "        bearer_token: scrape-token" <<<"$block"; then
      fail "job-bearer-$job" \
        "job '$job' does not send the metrics API key as its bearer token. /metrics answers 401 without it."
    fi
  done

  local app_keep workers_keep
  app_keep="$(scrape_job "$out" langwatch | keep_regex_for "$NAME_LABEL")"
  workers_keep="$(scrape_job "$out" langwatch-workers | keep_regex_for "$NAME_LABEL")"
  if [[ -n "$app_keep" && "$app_keep" == "$workers_keep" ]]; then
    fail "jobs-overlap" "both jobs keep the same pods ('$app_keep')."
  fi
}

test_pods_carry_scrape_annotations
test_no_annotations_when_metrics_off
test_each_job_selects_its_own_pods

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: Prometheus scrape targets pinned: (1) with metrics on, app and workers pods carry the scrape annotation and their own port; (2) with metrics off neither is annotated; (3) each job keeps only its own workload's pods, dials that workload's port and sends the metrics bearer token"
