# Dashboards as code (ADR-054)

Grafana dashboard JSON for the app's own metrics, versioned next to the
code that emits them — a metric rename and its dashboard change land in the
same review.

Import into any Grafana whose Prometheus datasource scrapes a langwatch
deployment (`/metrics` on the app and workers; the chart's bundled
Prometheus does this out of the box): *Dashboards → New → Import → upload
JSON*, then pick your Prometheus datasource when prompted. The same files
import into the local LGTM stack (ADR-042, `haven`), pointed at whatever
scrapes your dev processes.

| File | Covers |
| --- | --- |
| `event-sourcing-process-substrate.json` | Process-manager evolutions, outbox dispatch outcomes + drain lag, wake lag, suppressed intents (the ADR-051/052 substrate) |
| `topic-clustering.json` | Clustering run pages by outcome, page duration, dead-lettered clustering intents, wake lag for the daily schedule |

The alert rules that watch the same signals ship in the chart:
`charts/langwatch/files/alerting-rules.yml`.

The governance ingestion-pull dashboard follows once its process-manager
port (PR #5904) lands and the domain emits its own outcome metrics.
