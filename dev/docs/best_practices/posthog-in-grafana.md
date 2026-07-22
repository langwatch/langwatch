# PostHog data in Grafana

How to put PostHog's error-tracking data on a Grafana dashboard, and where to
put the alert that fires on it. Split out of
[ADR-058](../adr/058-full-stack-trace-correlation-browser-rum.md), which is
about trace correlation and not about this.

## Use Infinity for panels, not for alerts

With the [Infinity
datasource](https://grafana.com/docs/plugins/yesoreyeram-infinity-datasource/latest/)
installed, PostHog's HogQL query API backs dashboard panels directly. No export
pipeline is needed to *look* at the data.

Infinity is a poor alert source. Alerting requires its JSONata or JQ backend
parser to return numeric frames, evaluated against a rate-limited query API
whose own execution cap is 10 seconds — so a rule over a wide window fails as a
rule rather than firing. Alert *thresholds* should read a Prometheus counter
instead; use PostHog for the panel a human opens after the alert fires.

The fluent-bit path into Loki is documented as deliberately lossy under
pressure. That is correct for search and wrong for anything that must not miss,
which is another reason alerts do not read it.

## What it costs

Nothing beyond Grafana seats, at the time of writing.

- **PostHog bills ingestion, not reads.** There is no line item for API
  queries, HogQL queries, or rows scanned. Reading the same `$exception` data a
  thousand times a day costs nothing; the only lever on the bill is how many
  exceptions are sent. Suppression rules drop events pre-ingest and so do
  reduce it.
- **AWS Managed Grafana is per active user** ($9 editor/admin, $5 viewer, per
  workspace per month). Datasources, plugins, alert rules and alert evaluations
  add nothing. Note that an API request counts as activity, so a service
  account or a Terraform run makes that principal an active user.

## What actually constrains it

Rate limits, not money.

PostHog's query API allows **2,400 requests/hour per project**, 240/minute,
**3 concurrent**, with a 10-second execution cap per query. The limits are
project-wide — Grafana shares the budget with the application and with humans
in the PostHog UI.

Two consequences:

- **Put every PostHog alert rule in one Grafana evaluation group.** Rules
  within a group evaluate sequentially, so the concurrency limit of 3 is never
  approached. Spreading them across groups is the failure mode, not the fix.
- **Evaluate every 300s.** Ten rules at that interval is 120 requests/hour, 5%
  of quota, leaving room for dashboard loads (bursty, and far more numerous
  than alerts). 60s is defensible up to about five rules and buys little:
  `$exception` data is minutes-fresh at best.

**Check which limit the project is on before sizing anything.** PostHog
documents that some projects were never migrated off an older **120/hour**
limit, which is 20× tighter and makes polling-based alerting unworkable at any
real rule count.

**Check that Infinity is in the AMG plugin catalogue** before designing around
it. Managed Grafana only installs plugins from its own vetted catalogue and
cannot side-load; if it is absent, this approach needs rethinking rather than
adjusting.

## The alternative, and why it is not the default

PostHog's realtime destinations push instead of polling, so they consume no
query quota and deliver in near real time. They are a paid data-pipelines
add-on billed per trigger event beyond a free tier, and they need a receiver
Grafana can read — a pushgateway, Loki, a collector, a Lambda — which is the
larger cost if one is not already running.

The asymmetry is worth stating: polling costs a function of how often you ask,
webhooks cost a function of how much breaks. Polling has the better failure
mode, because an incident spike costs nothing, whereas an unfiltered webhook
destination bills most during your worst week. Prefer polling; if sub-minute
alerting is genuinely needed, filter the destination to interesting events
(a new issue, a threshold crossed) rather than every exception.

## Routing

Alerting needs no new machinery. Rules carrying `contact_point=prod-alerts` and
a severity label already reach `#alerting` through the existing root route, and
alert content is published from JSON rather than Terraform.

The authoritative alerting JSON does not live on the main checkout. Editing the
stale copy silently reverts work — see ADR-054.
