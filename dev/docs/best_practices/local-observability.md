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

## The stack

`compose.observability.yml` runs one container, `grafana/otel-lgtm`, which
bundles the OpenTelemetry Collector (OTLP on `:4317` gRPC / `:4318` HTTP, fanning
traces → Tempo, logs → Loki, metrics → Prometheus) and a pre-provisioned
Grafana on `:3000`. Data is **ephemeral** — there is no persistent volume, so
`make observability-down` discards everything. That keeps the footprint tiny and
retention naturally low. To persist + hard-cap retention, see the commented
block in `compose.observability.yml`.

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
