# Local observability (logs, traces, metrics → Grafana)

A lightweight, ephemeral **OTLP Collector + Loki + Tempo + Prometheus + Grafana**
stack you run on your laptop so that — while debugging local dev — you (and an
agent) always have **structured logs, distributed traces, and runtime metrics**
in one place. An agent reads them over the `gcx` CLI or the Grafana skills.

This is **local-dev only**. Production logging stays on AWS CloudWatch (see
`dev/docs/adr/003-logging.md`); this stack never touches the prod path. See
`dev/docs/adr/042-local-observability-stack.md` for the rationale.

## haven owns this stack

The stack is **not a compose service**. `haven` (thuishaven — the hostname-based
local-dev orchestrator) owns its lifecycle. That buys three things a raw
`docker compose up` did not:

- **It runs on colima, not Docker Desktop.** The VM has an explicit, per-profile
  RAM/CPU/disk ceiling, so a background telemetry stack can never take the whole
  machine. haven starts colima if it is down; a profile it creates is capped, one
  that already exists is never resized out from under you.
- **The container is capped, and the stores don't grow forever.** Memory, CPU,
  pid count and log rotation are set on the container. And because the bundle
  ships with **no retention at all** — Loki and Tempo keep every log and span
  until the disk fills — haven derives a config for each of the three stores from
  the image's own and mounts it back read-only with a short retention (default
  **2h**) plus a Prometheus size cap and a Loki ingestion-rate cap. Deriving from
  the image rather than vendoring means an image bump keeps upstream's defaults.
- **Every worktree wires itself up automatically.** Once the stack is up, each
  `pnpm dev` (i.e. `haven up`) writes the OTLP endpoint into that stack's
  `.env.portless` overlay and tags its telemetry `langwatch.worktree=<slug>`. No
  `.env` surgery, and one shared collector serves every worktree — filter Grafana
  to `langwatch.worktree="<your-slug>"` to see only your own logs, traces and
  metrics. `make observability-connect` remains for the Grafana token wiring
  an agent needs.

## TL;DR

```bash
make observability            # start the capped stack on colima (OTLP :4318, Grafana :3000)
                              #   (equivalently: haven observability up)
make observability-connect    # mint a Grafana token + configure gcx
# any pnpm dev stack you start while it is up exports to it automatically,
# tagged by worktree — no .env changes needed. Already-running stacks need a
# restart (pnpm dev) to pick it up.
make observability-down        # stop it (haven observability down) — discards all telemetry
```

Then open Grafana at http://localhost:3000 (anonymous Admin, or admin/admin), or
ask your agent to query it. `make haven doctor` (or `haven doctor`) reports
stack health and the image actually running.

### Tuning the caps

Retention and the resource ceilings live in `haven`'s
`domain.DefaultObservabilityLimits` (a debugging window, not an archive). The
stack keeps **no volume**, so `make observability-down` reclaims every byte
regardless. Override the image or ports with `HAVEN_OBS_IMAGE`,
`LW_OBS_GRAFANA_PORT`, `LW_OBS_OTLP_HTTP_PORT`; pick the colima profile with
`HAVEN_COLIMA_PROFILE`.

## What ships where

| Signal  | Backend    | TS app (`langwatch/`)                   | Go services (nlpgo, aigateway)                        |
| ------- | ---------- | --------------------------------------- | ---------------------------------------------------- |
| Traces  | Tempo      | `OTEL_EXPORTER_OTLP_ENDPOINT`           | dual-export via `OTEL_DEBUG_COLLECTOR_ENDPOINT`      |
| Logs    | Loki       | `PINO_OTEL_ENABLED=true`                | zap teed to OTLP via `OTEL_DEBUG_COLLECTOR_ENDPOINT` |
| Metrics | Prometheus | `OTEL_METRICS_ENABLED=true` (host/runtime) | Go runtime metrics via `OTEL_DEBUG_COLLECTOR_ENDPOINT` |

`make observability-connect` sets all of these in `platform/app/.env` for you
(backing it up first). The Go services **dual-export**: their product/customer
traces still go to the LangWatch app (dogfooding); their *own* operational
telemetry additionally goes to the collector. Setting
`OTEL_DEBUG_COLLECTOR_ENDPOINT` empty (the default everywhere, prod included)
leaves Go behavior byte-for-byte unchanged.

## Log correlation fields

Go log lines carry standard correlation fields (matching the TS app's
`getLogContext()` keys) so logs are filterable and joinable with traces:

- `trace_id`, `span_id` — the service's **own** active span.
- `project_id`, `team_id`, `organization_id` (and `user_id`/`tenant_id` when a
  service has them) — the tenant hierarchy, stamped at auth.
- `observed.trace_id`, `observed.span_id` — a **customer** trace the service is
  proxying/ingesting, kept distinct from its own. The AI gateway runs its own
  ops trace and stamps the customer's inbound trace as `observed.*`; nlpgo
  *continues* the customer's Studio trace, so that id is its `trace_id`.

The shared keys + helpers live in `pkg/clog/fields.go`
(`WithIdentity` / `WithSpanContext` / `WithObserved`).

## Quiet console, full detail in Grafana

Log levels are **unified across the TS app and the Go services** — one set of env
vars configures both:

| Var                 | Local value | Effect                                        |
| ------------------- | ----------- | --------------------------------------------- |
| `LOG_CONSOLE_LEVEL` | `warn`      | console (terminal) shows only warnings/errors |
| `LOG_OTEL_LEVEL`    | `debug`     | info + debug flow to the collector → Loki      |

`make observability-connect` sets these. So your terminal stays readable while
the full firehose is queryable in Grafana. On the Go side this is a split-core
tee (`pkg/clog` `WithCollector`); on the TS side it's pino's console vs OTel
transport levels — both keyed off the same variables (`PINO_*` remain as
fallbacks).

## The stack

The `otel-lgtm` service lives in `infra/compose.dev.yml` under the optional
`observability` profile — one `grafana/otel-lgtm` container that bundles the
OpenTelemetry Collector (OTLP on `:4317` gRPC / `:4318` HTTP, fanning traces →
Tempo, logs → Loki, metrics → Prometheus) and a pre-provisioned Grafana on
`:3000`. It's a shared singleton (fixed container name + host ports, no volume),
so every worktree exports to the same collector — which is what makes the
`langwatch.worktree` tag useful. It is not part of any `quickstart` preset;
`make observability` starts just this service and `make observability-down`
stops just this service (never the rest of the dev stack). Data is
**ephemeral** — no persistent volume — so a down discards everything, keeping the
footprint tiny and retention naturally low. To persist + hard-cap retention,
mount trimmed Loki/Tempo/Prometheus configs (otel-lgtm reads them from
`/otel-lgtm/*.yaml`).

Override ports if `:3000`/`:4318` are taken:

```bash
LW_OBS_GRAFANA_PORT=3100 LW_OBS_OTLP_HTTP_PORT=4319 make observability
```

## Reading the data as an agent

**When the stack is up, query this instead of grepping `platform/app/server.log`.**
Indexed attribute search (by service, level, trace id, worktree) finds the
failure far faster than scanning a multi-megabyte log file — and with the stack
up the console is muted to `warn+` (haven sets `LOG_CONSOLE_LEVEL`), so the
`info`/`debug` detail only lives here. `server.log` is the fallback for when the
stack is down.

Two ways, both wired by `make observability-connect`:

1. **gcx CLI** — Grafana's official CLI. `connect` runs `gcx login local
   --server http://localhost:3000 --token <token>`. Then:

   ```bash
   # Logs for one service, most recent first.
   gcx logs query '{service_name="langwatch-app"}' --since 15m
   # Only warnings/errors.
   gcx logs query '{service_name="langwatch-app"} | level=~"WARN|ERROR"' --since 15m
   # Everything for ONE trace, across services — the fast path from an error's
   # trace id (returned in the error body / the Langy "view trace" link) to its logs.
   gcx logs query '{service_name=~".+"} | trace_id="<traceId>"' --since 1h
   gcx traces query '<traceId>' --since 1h        # the trace itself, in Tempo
   gcx metrics query 'process_runtime_go_goroutines' --since 15m
   gcx datasources list
   ```

   **Filter to your own worktree.** Every stack tags its telemetry
   `langwatch.worktree=<slug>`, which lands in Loki as the structured-metadata
   field `langwatch_worktree` (NOT an indexed stream label). So when several
   worktrees share the one collector, isolate yours with a pipe filter, not a
   stream selector:

   ```bash
   gcx logs query '{service_name="langwatch-app"} | langwatch_worktree="<slug>"' --since 15m
   ```

   In Tempo the same tag is `resource.langwatch.worktree` in TraceQL:

   ```bash
   gcx traces query '{ resource.langwatch.worktree = "<slug>" }' --since 15m
   ```

2. **Grafana skills** — the `grafana-lgtm` / `grafana-core` / `grafana-datasources`
   plugins (`claude plugin marketplace add grafana/skills`) give the agent
   task-level knowledge for LogQL/PromQL/TraceQL and dashboards.

## Turning it off

```bash
make observability-down       # stop the stack (discards telemetry)
```

Restore your previous `platform/app/.env` from the `.env.bak.<timestamp>` that
`observability-connect` wrote, or just clear the OTLP vars.
