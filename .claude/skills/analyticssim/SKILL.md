---
name: analyticssim
description: "Catch and inspect PostHog and Customer.io calls with analyticssim, haven's product-analytics stand-in. Use when someone says 'did the tracking event fire', 'posthog events', 'customer.io identify', 'analyticssim', 'nurturing calls', 'what did the app send to analytics', or needs to assert on analytics in a test."
user-invocable: true
---

# analyticssim

Fakes PostHog (posthog-node `/batch/`, posthog-js `/e/`, `/flags/`) and Customer.io (CDP
`/v1/*`, Track API). Every call becomes one normalized record in memory. Keys are accepted
and never checked: a dev shim, never expose it. Code: `services/analyticssim`, console
`apps/analyticssim-web`.

## Run it

- Opt-in: `haven up +analytics` (sticky). Hosted in the `sims` lane.
- Console and ingest base URL: `https://analytics.<slug>.langwatch.localhost`; `haven status`
  shows the loopback port.
- The overlay points the PostHog host and Customer.io base at it with dummy keys where none
  is set. Standalone: `make service svc=analyticssim` (:5596).

## Inspect and assert

```
GET    /_sim/api/records?provider=posthog|customerio&kind=event|identify|alias|group&id=&name=
GET    /_sim/api/status
DELETE /_sim/api/records
```

Records carry `provider`, `kind`, `distinctId`, `name`, `properties`, `receivedAt` and `raw`.
Newest first. Assert: trigger the action, then filter by `id` and `name`.

## Seed and reset

- `ANALYTICSSIM_SEED=1` (haven sets it) loads sample PostHog and Customer.io records.
- Reset with `DELETE /_sim/api/records`; a restart also empties it (nothing persists).

## Tests and load

- Post PostHog batches or Customer.io calls at the loopback port; 16 MiB body cap.
- The store is a fixed ring: adding is O(1). `ANALYTICSSIM_MAX_RECORDS` (default 5000),
  `ANALYTICSSIM_MAX_RAW_BYTES` (default 65536; bigger raw bodies become a size marker).
  Benchmark: `go test -bench . -benchmem ./services/analyticssim`.
