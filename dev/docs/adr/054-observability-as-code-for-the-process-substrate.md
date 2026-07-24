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

And then this repo ships nothing that listens. Prod observability lives
in `langwatch-saas/infrastructure/grafana/` — reviewed dashboard and
alert JSON for AWS Managed Grafana, including an event-sourcing runtime
dashboard — but the public repo carries **no alert rule at all**, so
self-hosted deployments get silence, counters written explicitly "to be
alerted on" (`langwatch_edge_spool_fail_open_total`,
`langwatch_evaluator_loop_blocked_total`) ship alert-less, and a metric
added here has no in-repo contract keeping it alive. Meanwhile ADR-051
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

1. **Alert rules live in the infra repo, not the chart.** (Amended: the
   chart originally shipped `alerting_rules.yml` from
   `charts/langwatch/files/alerting-rules.yml`; that was removed —
   self-hosted operators don't need our alert taxonomy imposed on them,
   and shipping rules meant every rule change was a chart release.) The
   reviewed rules are provisioned with the rest of the Grafana tier in
   the SaaS infrastructure repo; the chart's bundled Prometheus keeps
   scraping the same metrics, so an operator who wants alerts can point
   their own rules at them.

2. **Dashboards live in the infra repo**, not here: prod Grafana (AWS
   Managed Grafana) is provisioned from
   `langwatch-saas/infrastructure/grafana/*.json` — reviewed JSON records
   published via `gcx api /api/dashboards/db --context lw-prod`. The
   substrate panels extend the existing `langwatch-event-sourcing-runtime`
   dashboard there; topic clustering gets its own dashboard alongside it.
   This public repo ships no dashboards — a metric rename here must be
   paired with a dashboard PR there (the alert rules below are the
   in-repo guard that the metric still exists).

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
   executor. The governance ingestion pullers, now on the same substrate
   (PR #5904), get theirs: `ingestion_pull_total{outcome}` (completed |
   failed_retryable | failed_final) and
   `ingestion_pull_duration_milliseconds` (unlabelled — the executor
   knows no cheap low-cardinality source label) from the pull intent
   executor.

## Consequences

- An outbox dead-letter, a >30-minute wake delay, a sustained
  suppressed-intent rate, or a final clustering failure now fires a
  reviewed, versioned alert in every deployment — instead of relying on
  someone reading Loki.
- Self-hosted operators inherit sane alerts for free and can silence or
  extend them through standard Prometheus tooling.
- Prod dashboards and their Grafana-managed alert routing (Slack
  contact point, notification policies) stay in `langwatch-saas`
  infrastructure, where they already live; the chart rules are the
  self-hosted and defense-in-depth tier.
- Rules are chart-tested by the existing `helm template` CI matrix.

## Alternatives considered

- **Grafana-managed alerting only** (extend the `langwatch-saas` alert
  records and skip chart rules): leaves every self-hosted deployment
  silent and gives this repo no contract over its own metric names;
  Prometheus rules run wherever the chart runs, and the Grafana tier
  remains the prod routing layer on top.
- **A metrics helper in `@langwatch/observability`** to unify the two
  registries and naming conventions: real gap, separate change — noted,
  not taken here.
- **Backlog-depth gauges via store polling** (like GroupQueue's
  collector): more machinery (new store queries + a poller) for a signal
  the two lag histograms already imply. Revisit if lag alone proves
  insufficient.
