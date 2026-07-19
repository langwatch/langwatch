# ADR-054: Observability-as-code for the process-manager substrate

**Date:** 2026-07-19

**Status:** Accepted

**Extends:** ADR-042 (local observability stack), ADR-049/051/052 (the
process-manager substrate and its domains).

## Context

The event-sourcing substrate is the best-instrumented area of the app —
`es_*` counters and histograms cover commands, projections, subscribers,
process-manager evolutions and outbox dispatch; GroupQueue polls its own
`gq_*` family. The chart scrapes all of it (`templates/prometheus.yaml`).

And then nothing listens. The repo contains **no alert rule and no
dashboard for its own metrics** — not in the chart, not in provisioning,
nowhere. Counters written explicitly "to be alerted on"
(`langwatch_edge_spool_fail_open_total`,
`langwatch_evaluator_loop_blocked_total`) ship without an alert. Prod
Grafana is managed out of band, so every alert and dashboard that exists
today is hand-built, unversioned, and unreviewable. Meanwhile ADR-051
moved topic clustering onto durable wakes and a lease-fenced outbox —
failure modes (dead-lettered intents, overdue wakes, suppressed
duplicate intents) that are *designed* to be quiet in the product and
therefore MUST page somewhere.

Two instrumentation gaps compound this: the wake and outbox workers log
but emit no latency signals (nothing measures "how late do wakes fire"
or "how long do intents sit before dispatch"), and domains on the
substrate have no domain-level outcome metric (topic clustering's run
outcomes exist only as events and log lines).

## Decision

1. **Alert rules ship in the chart.** The chart already renders its own
   `prometheus.yml` ConfigMap; it now also renders
   `alerting_rules.yml` from `charts/langwatch/files/alerting-rules.yml`
   and lists it under `rule_files`. Every deployment (ours and
   self-hosted) evaluates the same reviewed rules; firing alerts are
   visible in Prometheus (`/alerts`, the `ALERTS` series) and in any
   Grafana pointed at that Prometheus. Routing to receivers
   (Alertmanager, PagerDuty, Slack) stays an operator concern — the
   rules define *what is wrong*, values define *who hears it*.
   `prometheus.alerting.enabled` (default true) opts out.

2. **Dashboards ship in the repo** under
   `dev/observability/dashboards/*.json` — plain Grafana dashboard JSON,
   importable into any Grafana (prod, or the local LGTM stack). They are
   versioned next to the metrics they read, so a metric rename in a PR
   shows up as a dashboard diff in the same PR.

3. **The substrate emits the latency signals the alerts need:**
   - `es_process_wake_lag_milliseconds{process_name}` — scheduledFor →
     handled, observed by the wake worker. The direct answer to "is the
     scheduler stalling".
   - `es_process_outbox_dispatch_lag_milliseconds{process_name}` —
     enqueue → dispatch start, observed by the dispatcher. The direct
     answer to "is the outbox draining".
   - `es_process_intents_suppressed_total{process_name}` — commits whose
     intents were dropped as already-dispatched. Legitimate on
     redelivery; a sustained rate is exactly how the lost-day scheduling
     bug hid (ADR-051).

4. **Substrate domains get one outcome metric each.** Topic clustering:
   `topic_clustering_page_total{outcome}` (completed | skipped |
   failed_retryable | failed_final) and
   `topic_clustering_page_duration_milliseconds{mode}` from the intent
   executor. The governance ingestion pullers get the same treatment
   when their process-manager port lands (PR #5904).

## Consequences

- An outbox dead-letter, a >30-minute wake delay, a sustained
  suppressed-intent rate, or a final clustering failure now fires a
  reviewed, versioned alert in every deployment — instead of relying on
  someone reading Loki.
- Self-hosted operators inherit sane alerts for free and can silence or
  extend them through standard Prometheus tooling.
- The dashboards directory is the start of dashboards-as-code; prod
  Grafana imports remain a manual step until provisioning is wired
  (deliberately out of scope here).
- Rules are chart-tested by the existing `helm template` CI matrix.

## Alternatives considered

- **Grafana-provisioned alerting** (alert rules as Grafana YAML):
  rejected for now — prod Grafana is out-of-band and unprovisioned, so
  the rules would run nowhere by default; Prometheus rules run wherever
  the chart runs.
- **A metrics helper in `@langwatch/observability`** to unify the two
  registries and naming conventions: real gap, separate change — noted,
  not taken here.
- **Backlog-depth gauges via store polling** (like GroupQueue's
  collector): more machinery (new store queries + a poller) for a signal
  the two lag histograms already imply. Revisit if lag alone proves
  insufficient.
