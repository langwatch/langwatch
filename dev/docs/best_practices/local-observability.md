# Local observability (logs, traces, metrics → Grafana)

A lightweight, ephemeral **OTLP Collector + Loki + Tempo + Prometheus + Grafana**
stack you run on your laptop so that — while debugging local dev — you (and an
agent) always have **structured logs, distributed traces, and runtime metrics**
in one place. An agent reads them over the Grafana MCP, the `gcx` CLI, or the
Grafana skills.

This is **local-dev only**. Production logging stays on AWS CloudWatch (see
`dev/docs/adr/003-logging.md`); this stack never touches the prod path. See
`dev/docs/adr/042-local-observability-stack.md` for the rationale.

## TL;DR

```bash
make observability            # start the stack (OTLP :4318, Grafana :3000)
make observability-connect    # point langwatch/.env at it + wire the Grafana MCP + gcx
# restart your app so it picks up the .env changes:
make quickstart <preset>      # or: cd langwatch && pnpm dev
```

Then open Grafana at http://localhost:3000 (anonymous Admin, or admin/admin), or
ask your agent to query it.

## What ships where

| Signal  | Backend    | TS app (`langwatch/`)                   | Go services (nlpgo, aigateway)                        |
| ------- | ---------- | --------------------------------------- | ---------------------------------------------------- |
| Traces  | Tempo      | `OTEL_EXPORTER_OTLP_ENDPOINT`           | dual-export via `OTEL_DEBUG_COLLECTOR_ENDPOINT`      |
| Logs    | Loki       | `PINO_OTEL_ENABLED=true`                | zap teed to OTLP via `OTEL_DEBUG_COLLECTOR_ENDPOINT` |
| Metrics | Prometheus | `OTEL_METRICS_ENABLED=true` (host/runtime) | Go runtime metrics via `OTEL_DEBUG_COLLECTOR_ENDPOINT` |

`make observability-connect` sets all of these in `langwatch/.env` for you
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

The `otel-lgtm` service lives in `compose.dev.yml` under the optional
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

Three ways, all wired by `make observability-connect`:

1. **Grafana MCP** — a `grafana-local` MCP server (the same `grafana/mcp-grafana`
   image used for `grafana-prod`) pointed at the local Grafana with a minted
   service-account token. Restart Claude Code to load it, then the
   `query_loki_logs` / `query_prometheus` / Tempo tools work against local data.
2. **gcx CLI** — Grafana's official CLI. `connect` runs `gcx login local
   --server http://localhost:3000 --token <token>`. Then:
   ```bash
   gcx logs query '{service_name="langwatch-backend"}' --since 15m
   gcx metrics query 'process_runtime_go_goroutines' --since 15m
   gcx traces query '{ .service.name = "langwatch-ai-gateway" }' --since 15m
   gcx datasources list
   ```
3. **Grafana skills** — the `grafana-lgtm` / `grafana-core` / `grafana-datasources`
   plugins (`claude plugin marketplace add grafana/skills`) give the agent
   task-level knowledge for LogQL/PromQL/TraceQL and dashboards.

## Turning it off

```bash
make observability-down       # stop the stack (discards telemetry)
```

Restore your previous `langwatch/.env` from the `.env.bak.<timestamp>` that
`observability-connect` wrote, or just clear the OTLP vars.
