# Telemetry environment: one small set (plan, 2026-10-09)

Status: design only, nothing implemented. ADR draft: `dev/docs/adr/175-telemetry-env.md` (Proposed).

Scope: how LangWatch's **own** logs, traces, metrics and profiles are switched and pointed by
environment variables, in every process: api, worker, tasks, scenario-child, the server CLI, the Go
services (aigateway, nlpgo, langyagent) and langevals. Customer trace routing (per-project OTLP
tokens, `LANGWATCH_ENDPOINT`, the customer trace bridge) is product configuration and stays out of
the `OTEL_*` namespace, as `pkg/config/otel.go:27-31` already rules.

## 1. The short version

| Signal                     | Proposed default              | Switch                                                                    | Standard name?                    |
| -------------------------- | ----------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| Traces                     | ✅ on when a collector is set | `OTEL_TRACES_EXPORTER=otlp\|none`                                         | ✅                                |
| Logs to collector          | ✅ on when a collector is set | `OTEL_LOGS_EXPORTER=otlp\|none`                                           | ✅                                |
| Metrics push               | ✅ on when a collector is set | `OTEL_METRICS_EXPORTER=otlp\|none`                                        | ✅                                |
| Prometheus pull `/metrics` | ❌ off                        | `OTEL_METRICS_EXPORTER=otlp,prometheus` + `OTEL_EXPORTER_PROMETHEUS_PORT` | ✅                                |
| Console logs               | ✅ always                     | `LOG_LEVEL`, `LOG_FORMAT`, `LOG_CONSOLE_LEVEL`                            | LangWatch, already shared with Go |
| Profiling                  | ❌ off                        | `PYROSCOPE_SERVER_ADDRESS`                                                | Pyroscope's own                   |
| Everything                 |                               | `OTEL_SDK_DISABLED=true` kills all OTel signals                           | ✅                                |

The collector is one variable, `OTEL_EXPORTER_OTLP_ENDPOINT` (+ `OTEL_EXPORTER_OTLP_HEADERS`, a
secret). Unset means nothing is exported: we never guess `localhost:4318`.

Only three LangWatch-specific names survive beyond the standard set: `LOG_LEVEL` (+ two per-sink
overrides), the scrape bearer, and `ENVIRONMENT`/`SERVICE_VERSION`, which are deployment facts read
by more than telemetry.

## 2. Picture

```
               one set of env names, read the same way by every process
                                     │
     ┌───────────────────────────────┼────────────────────────────────┐
     │ TS: observabilityOwner        │ Go: pkg/config.OTel + clog     │ Py: langevals logging
     │ (api, worker, tasks,          │ (aigateway, nlpgo, langyagent) │ (LOG_LEVEL only, Q8)
     │  scenario-child, server CLI)  │                                │
     └───────────────┬───────────────┴────────────────┬───────────────┘
                     ▼                                ▼
     one TracerProvider + LoggerProvider + MeterProvider per process
       │ traces          │ logs              │ metrics (two readers, one provider)   │ profiles
       ▼                 ▼                   ├─────────────────────┐                 ▼
  OTLP /v1/traces   OTLP /v1/logs      OTLP /v1/metrics      :9464/metrics       Pyroscope
  on if endpoint    on if endpoint     on if endpoint        OFF unless          OFF unless
                                                             listed in            address set
       └─────────────────┴───────────────────┘               OTEL_METRICS_EXPORTER
          OTEL_EXPORTER_OTLP_ENDPOINT (+ _HEADERS secret)    bearer: METRICS_API_KEY
  stdout: LOG_FORMAT (json|pretty), level LOG_CONSOLE_LEVEL ?? LOG_LEVEL
```

## 3. What is wrong today (HEAD of this branch)

| #   | Finding                                                                                                                                                                                                         | Evidence                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Metrics are either/or: `prometheus` mode turns the OTLP push **off**                                                                                                                                            | `packages/observability/src/node/process-metrics.ts:41-52`                                                    |
| 2   | Record says absent mode means `prometheus`; code defaults `otlp`                                                                                                                                                | `dev/docs/ARCHITECTURE.md:809-814` vs `packages/process/src/observability-owner.ts:46`                        |
| 3   | Two names for the scrape bearer: `LANGWATCH_METRICS_TOKEN` (read) and `METRICS_API_KEY` (main's name, declared by ops, read by nothing)                                                                         | `telemetry-settings.ts:52`, `modules/ops/contract/src/ops.config.ts:29`                                       |
| 4   | Three log-level families: `PINO_LOG_LEVEL` (TS api/worker), `LOG_LEVEL` (Go, langevals), `_LOG_LEVEL` (main and server CLI). Go's `clog` claims it shares `LOG_LEVEL` with TS; TS does not read it              | `observability-owner.ts:37`, `pkg/clog/clog.go:272-276`, `apps/server/src/task/task.executable.ts:32`         |
| 5   | `PINO_CONSOLE_LEVEL` / `PINO_OTEL_LEVEL` fallbacks: main read them, api/worker dropped them silently, server CLI still reads them                                                                               | main `packages/observability/src/logger.ts:170-173`                                                           |
| 6   | apps/tasks and scenario-child read no telemetry env at all: debug level, default service name                                                                                                                   | `apps/tasks/src/main.ts:105`, `apps/scenario-child/src/config.ts:77`                                          |
| 7   | `OTEL_SERVICE_NAME` is ignored by api/worker (hard-coded `langwatch-api`/`langwatch-worker`) though the chart sets `langwatch-app`/`langwatch-workers`, main's names. Dashboards keyed on main's names go blank | `apps/api/src/main.ts:45`, `apps/worker/src/main.ts:31`, `charts/langwatch/templates/app/deployment.yaml:150` |
| 8   | TS reads `OTEL_TRACES_SAMPLER_ARG` but not `OTEL_TRACES_SAMPLER`; Go reads both                                                                                                                                 | `observability-owner.ts:34`, `pkg/config/otel.go:69-70`                                                       |
| 9   | Log export off unless `PINO_OTEL_ENABLED=true` (non-standard, TS only)                                                                                                                                          | `observability-owner.ts:40`                                                                                   |
| 10  | `OTEL_METRICS_ENABLED` is non-standard and means opposite defaults on main (opt-in) and HEAD (opt-out)                                                                                                          | main `instrumentation.node.ts:194`, `observability-owner.ts:47-53`                                            |
| 11  | Profiling: `startProfiling` has no caller in TS; main started it from `PYROSCOPE_SERVER_ADDRESS`                                                                                                                | `packages/observability/src/node/profiling.ts`, main `instrumentation.node.ts:270-274`                        |
| 12  | No instrumentations or resource detectors in TS; main had AWS SDK, OpenAI, Pino, runtime-node, opt-in ioredis, and `awsEksDetector` + `envDetector`                                                             | `process-telemetry.ts:44-57`, main `instrumentation.node.ts:117,144-148`                                      |
| 13  | `OTEL_TRACE_REDIS_COMMANDS` is documented but read by nothing                                                                                                                                                   | `.env.example:440`                                                                                            |
| 14  | Go services export logs only to the local debug collector, never the primary one                                                                                                                                | `pkg/otelsetup/otelsetup.go:558-570`                                                                          |
| 15  | aigateway mounts `/metrics` on its public router whenever metrics exist, which is always; auth not verified here                                                                                                | `services/aigateway/deps.go:82`, `adapters/httpapi/router.go:154-155`                                         |
| 16  | `WORKER_METRICS_PORT` is really the worker's health port (`/healthz` and the scrape door)                                                                                                                       | `packages/process/src/config.ts:16`                                                                           |
| 17  | `loggerConfigurationFrom` is dead; the live mapper is private to `process-telemetry.ts:59-71`; the server CLI hand-rolls a third                                                                                | residue handoff, `task.executable.ts:18-46,149-162`                                                           |

## 4. Inventory: every name, who reads it

`TS` = `packages/process/src/observability-owner.ts` unless a file is named. `main` = `origin/main`.

| Name                                                                      | HEAD readers                                                                            | main readers                                      | Proposed                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                             | TS (`@langwatch/config` deployment-facts), Go `pkg/config/otel.go`, rum fallback, haven | `instrumentation.node.ts:23`, Go                  | ✅ keep, canonical                                                          |
| `OTEL_EXPORTER_OTLP_HEADERS` (secret)                                     | TS `@langwatch/secrets` shared-secrets, Go                                              | instrumentation (via exporter env), Go            | ✅ keep                                                                     |
| `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT`, `..._TRACES_HEADERS` | Go only                                                                                 | Go only                                           | ✅ honour in TS too                                                         |
| `OTEL_EXPORTER_OTLP_PROTOCOL`                                             | Go (validates)                                                                          | Go                                                | ✅ keep; TS supports `http/protobuf`, warns on others                       |
| `OTEL_SDK_DISABLED`                                                       | Go                                                                                      | Go                                                | ✅ honour in TS too                                                         |
| `OTEL_TRACES_EXPORTER`                                                    | Go                                                                                      | Go                                                | ✅ TS too                                                                   |
| `OTEL_METRICS_EXPORTER`                                                   | nobody (only customer-facing snippets)                                                  | nobody                                            | ✅ new canonical metrics switch, `prometheus` value = pull door             |
| `OTEL_LOGS_EXPORTER`                                                      | nobody (snippets)                                                                       | nobody                                            | ✅ new canonical log-export switch                                          |
| `OTEL_EXPORTER_PROMETHEUS_PORT` / `_HOST`                                 | nobody                                                                                  | nobody                                            | ✅ new: pull door listener, default `9464` / `0.0.0.0`                      |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`                          | TS (ARG only), Go                                                                       | instrumentation (SDK env), Go                     | ✅ both, everywhere                                                         |
| `OTEL_SERVICE_NAME`                                                       | Go, server CLI; chart sets it; **api/worker ignore it**                                 | instrumentation (default `langwatch-app`), logger | ✅ honour; per-process default                                              |
| `OTEL_RESOURCE_ATTRIBUTES`                                                | TS, Go, profiling tags                                                                  | `envDetector`                                     | ✅ keep                                                                     |
| `ENVIRONMENT`                                                             | TS → `deployment.environment.name`                                                      | instrumentation                                   | ✅ keep (deployment fact)                                                   |
| `SERVICE_VERSION`                                                         | `@langwatch/config`                                                                     | logger                                            | ✅ keep (deployment fact)                                                   |
| `LOG_LEVEL`                                                               | Go `clog`, langevals topic clustering, `run-script.ts`, one langy script                | Go, langevals                                     | ✅ canonical everywhere                                                     |
| `PINO_LOG_LEVEL`                                                          | TS, server CLI, vite config                                                             | logger                                            | ⚠️ alias of `LOG_LEVEL`                                                     |
| `_LOG_LEVEL`                                                              | server CLI                                                                              | logger `:345`                                     | ⚠️ alias of `LOG_LEVEL`                                                     |
| `GATEWAY_LOG_LEVEL`                                                       | aigateway `config.go:391`                                                               | aigateway                                         | ⚠️ alias of `LOG_LEVEL`                                                     |
| `LOG_FORMAT`                                                              | TS, server CLI, Go `clog`, haven                                                        | logger, Go                                        | ✅ keep                                                                     |
| `LOG_CONSOLE_LEVEL`                                                       | TS, server CLI, Go                                                                      | logger, Go                                        | ✅ keep, defaults to `LOG_LEVEL`                                            |
| `PINO_CONSOLE_LEVEL`                                                      | server CLI                                                                              | logger                                            | ⚠️ alias of `LOG_CONSOLE_LEVEL`                                             |
| `LOG_OTEL_LEVEL`                                                          | TS, server CLI, Go                                                                      | logger (default `debug`)                          | ✅ keep, defaults to `LOG_LEVEL` (Q6)                                       |
| `PINO_OTEL_LEVEL`                                                         | server CLI                                                                              | logger                                            | ⚠️ alias of `LOG_OTEL_LEVEL`                                                |
| `PINO_OTEL_ENABLED`                                                       | TS, server CLI, haven                                                                   | instrumentation, logger                           | ⚠️ alias: `true`→`OTEL_LOGS_EXPORTER=otlp`, `false`→`none`                  |
| `OTEL_METRICS_ENABLED`                                                    | TS (opt-out), Go, haven                                                                 | instrumentation (opt-in)                          | ⚠️ alias: `false`→`OTEL_METRICS_EXPORTER=none`                              |
| `LANGWATCH_METRICS_MODE`                                                  | TS, chart                                                                               | **never on main**                                 | ❌ delete outright, no alias                                                |
| `LANGWATCH_METRICS_TOKEN` (secret)                                        | TS, chart                                                                               | **never on main**                                 | ❌ delete outright (Q4)                                                     |
| `METRICS_API_KEY` (secret)                                                | ops config leaf, unused                                                                 | `/metrics` bearer, chart                          | ✅ canonical scrape bearer (Q4); ops leaf deleted                           |
| `WORKER_METRICS_PORT`                                                     | worker health port, server CLI, haven                                                   | worker metrics + health port                      | ✅ keep as the health port (Q9)                                             |
| `OTEL_OTLP_ENDPOINT`, `OTEL_OTLP_HEADERS`, `OTEL_SAMPLE_RATIO`            | Go (deprecated, warns)                                                                  | Go                                                | ⚠️ already aliases; set a removal release                                   |
| `GATEWAY_OTEL_DEFAULT_ENDPOINT`                                           | aigateway `config.go:392` fallback for `OTEL_OTLP_ENDPOINT`                             | aigateway                                         | ⚠️ alias; lane confirms it is ops, not customer routing                     |
| `OTEL_DEBUG_COLLECTOR_ENDPOINT` / `_HEADERS`                              | Go, haven (local only, ADR-042)                                                         | Go                                                | ✅ keep: a LangWatch extension, dev only                                    |
| `OTEL_TRACE_REDIS_COMMANDS`                                               | `.env.example` only                                                                     | `instrumentation.redis.ts`                        | ⚠️ alias for the ioredis entry in `OTEL_NODE_ENABLED_INSTRUMENTATIONS` (Q5) |
| `PYROSCOPE_SERVER_ADDRESS`                                                | Go `pkg/profiling`, haven                                                               | instrumentation `:271`, Go                        | ✅ keep; wire TS                                                            |
| `LANGEVALS_STAGED_LOG_LEVEL`                                              | langevals staged payload logger                                                         | same                                              | ✅ keep: a component override, not a sink                                   |
| `TEXT_LOG_LEVEL`, `ENABLE_PROMETHEUS_METRICS`                             | `infra/clickhouse-serverless`                                                           | same                                              | out of scope: separate infra binary                                         |
| `GRAFANA_BASE_URL`, `GRAFANA_*_DATASOURCE_UID`                            | declared in `deployment-facts.ts`, unwired                                              | error handler links                               | out of scope: deep links, needs its own ruling                              |

## 5. Before and after

| Concern               | main                                                             | HEAD (branch)                                                      | Proposed                                                                          |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Collector             | `OTEL_EXPORTER_OTLP_ENDPOINT` (+ Go deprecated `OTEL_OTLP_*`)    | same                                                               | same, plus per-signal endpoints in TS                                             |
| Kill switch           | Go only                                                          | Go only                                                            | `OTEL_SDK_DISABLED` everywhere                                                    |
| Traces on             | endpoint set                                                     | endpoint set                                                       | endpoint set; `OTEL_TRACES_EXPORTER=none` turns off                               |
| Sampler               | SDK env (TS), both (Go)                                          | ARG only (TS)                                                      | `OTEL_TRACES_SAMPLER` + `_ARG` everywhere                                         |
| Service name          | `OTEL_SERVICE_NAME`, default `langwatch-app`                     | hard-coded                                                         | `OTEL_SERVICE_NAME`, per-process default                                          |
| Resource              | `OTEL_RESOURCE_ATTRIBUTES` + `envDetector` + `awsEksDetector`    | hand-parsed attrs, no detectors                                    | attrs + both detectors (no preload needed)                                        |
| Log level             | `PINO_LOG_LEVEL` / `_LOG_LEVEL` (TS), `LOG_LEVEL` (Go)           | `PINO_LOG_LEVEL` api/worker, nothing in tasks/child                | `LOG_LEVEL` everywhere                                                            |
| Sink levels           | console `info`, OTel `debug` defaults                            | same names, no `PINO_*` fallback                                   | both default to `LOG_LEVEL`                                                       |
| Logs to collector     | opt-in `PINO_OTEL_ENABLED`                                       | same                                                               | on by default; `OTEL_LOGS_EXPORTER=none`                                          |
| Go logs to collector  | debug collector only                                             | same                                                               | primary collector too                                                             |
| Metrics push          | opt-in `OTEL_METRICS_ENABLED=true`                               | on unless `false`, and off in prometheus mode                      | on by default; `OTEL_METRICS_EXPORTER=none`                                       |
| Prometheus pull       | `/metrics` always mounted on web port + worker port, prom-client | `LANGWATCH_METRICS_MODE=prometheus`, replaces push                 | off; `OTEL_METRICS_EXPORTER=otlp,prometheus`, own port `9464`, push keeps running |
| Scrape bearer         | `METRICS_API_KEY`, fail closed in production                     | `LANGWATCH_METRICS_TOKEN`, door unmounted in production without it | `METRICS_API_KEY`, same fail-closed rule                                          |
| Gateway `/metrics`    | (not checked)                                                    | public router, always                                              | behind the same switch and port                                                   |
| Profiling             | `PYROSCOPE_SERVER_ADDRESS` (TS + Go)                             | Go only, TS has no caller                                          | `PYROSCOPE_SERVER_ADDRESS` in every process                                       |
| Node instrumentations | AWS SDK, OpenAI, Pino, runtime-node on; ioredis opt-in           | none                                                               | runtime-node + detectors now; patching ones per Q5                                |
| tasks, scenario-child | read main's logger env                                           | read nothing                                                       | read the same owner slice                                                         |

## 6. Defaults per process

|                            | api | worker | tasks          | scenario-child | server CLI | aigateway | nlpgo | langyagent | langevals |
| -------------------------- | --- | ------ | -------------- | -------------- | ---------- | --------- | ----- | ---------- | --------- |
| Traces (endpoint set)      | ✅  | ✅     | ✅             | ✅             | ✅         | ✅        | ✅    | ✅         | ❌ (Q8)   |
| Logs to collector          | ✅  | ✅     | ✅             | ✅             | ✅         | ✅        | ✅    | ✅         | ❌        |
| Metrics push               | ✅  | ✅     | ❌ short-lived | ❌ short-lived | ✅         | ✅        | ✅    | ✅         | ❌        |
| Pull door when enabled     | ✅  | ✅     | ❌             | ❌             | ✅         | ✅        | ✅    | ✅         | ❌        |
| Profiling when address set | ✅  | ✅     | ❌             | ❌             | ✅         | ✅        | ✅    | ✅         | ❌        |
| `LOG_LEVEL` honoured       | ✅  | ✅     | ✅             | ✅             | ✅         | ✅        | ✅    | ✅         | ✅        |

Several processes on one host (haven, the server CLI) each get their own
`OTEL_EXPORTER_PROMETHEUS_PORT`; both already allocate port slots.

## 7. How each piece works

- **One provider, two metric readers.** The OTel SDK takes several readers on one `MeterProvider`.
  The push reader and the existing `PrometheusPullReader` (`prometheus-exposition.ts`) share the
  provider, so both see the same families, histogram views (`process-metrics.ts:132-153`) and host
  metrics. This deletes the either/or branch rather than adding a mode.
- **The pull door gets its own listener** on `OTEL_EXPORTER_PROMETHEUS_HOST:PORT`, never the public
  port. Bearer: `METRICS_API_KEY` when set; in production an unset key leaves the door unmounted and
  logs one error naming the variable (today's rule at `process-metrics.ts:81-89`, main's fail-closed).
- **Aliases live in one table per language**: `{ old, new, translate?, removeIn }`. Each old name
  read logs one boot warning, `<OLD> is deprecated, use <NEW>; it stops being read in <release>`.
  Old and new both set to **different** values is a boot error, never a guess: Go already does this
  (`pkg/config/otel.go:22-25`), TS copies it. A unit test fails once the running version reaches an
  entry's `removeIn`, so removal cannot be forgotten.
- **Profiling** joins the owner slice as `profiling.serverAddress` and starts from
  `processTelemetry`, using the already-written `startProfiling`. App name = the resolved service
  name, tags from `OTEL_RESOURCE_ATTRIBUTES` (as main and Go do).
- **Instrumentations that need no module patching** land by default: `envDetector`,
  `awsEksDetector`, runtime-node, and trace ids on log records through the logger's mixin. The ones
  that patch modules (AWS SDK, OpenAI, ioredis) need code to run before those modules load: see Q5.
- **tasks, scenario-child and the server CLI** read the same `observabilityOwner` slice through the
  one mapper (export `process-telemetry.ts`'s `loggerConfiguration`, delete `loggerConfigurationFrom`
  and the server CLI's copy).

## 8. Migration for self-hosters

Release N (first release from this branch):

| They set (main)                                              | What happens in N                                                         | What to change                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PINO_LOG_LEVEL`, `_LOG_LEVEL`                               | read as `LOG_LEVEL`, warning                                              | rename to `LOG_LEVEL`                                                                                                                                 |
| `PINO_CONSOLE_LEVEL`, `PINO_OTEL_LEVEL`                      | read as `LOG_CONSOLE_LEVEL` / `LOG_OTEL_LEVEL`, warning                   | rename                                                                                                                                                |
| `PINO_OTEL_ENABLED=true`                                     | logs exported (now the default anyway), warning                           | delete it                                                                                                                                             |
| nothing, endpoint set                                        | **logs and metrics now also exported**                                    | set `OTEL_LOGS_EXPORTER=none` / `OTEL_METRICS_EXPORTER=none` if the collector has no such pipeline                                                    |
| `OTEL_METRICS_ENABLED=true/false`                            | `otlp` / `none`, warning                                                  | delete it, or `OTEL_METRICS_EXPORTER=none`                                                                                                            |
| `METRICS_API_KEY` + a scrape of app `/metrics`               | `/metrics` still served at the old place **and** on `:9464`, warning (Q3) | point the scrape at `:9464`, set `OTEL_METRICS_EXPORTER=otlp,prometheus`                                                                              |
| a scrape of the AI gateway's `/metrics` on `:5563`           | the gateway serves metrics on its own listener, `:9464`                   | set `OTEL_METRICS_EXPORTER=otlp,prometheus` and `METRICS_API_KEY`, scrape `:9464` with `Authorization: Bearer <key>`; the chart has `metrics.enabled` |
| `OTEL_OTLP_ENDPOINT` / `_HEADERS` / `OTEL_SAMPLE_RATIO` (Go) | unchanged: already warned                                                 | rename to the standard names                                                                                                                          |
| `GATEWAY_LOG_LEVEL`                                          | read as `LOG_LEVEL`, warning                                              | rename                                                                                                                                                |
| `OTEL_TRACE_REDIS_COMMANDS=true`                             | ioredis instrumentation on (if Q5 lands), warning                         | `OTEL_NODE_ENABLED_INSTRUMENTATIONS`                                                                                                                  |
| Helm chart values                                            | chart writes the new names itself                                         | nothing                                                                                                                                               |

Removal: every alias is read until the supported upgrade window (the LTS floor) no longer contains a
release without the new names; the release after that deletes the table rows. The public docs get one
"Telemetry configuration" page and an upgrade note listing this table.

## 9. Go services

Already closest to the target: `pkg/config/otel.go` reads the standard names with deprecated aliases
and conflict errors; `pkg/clog` reads `LOG_LEVEL`/`LOG_FORMAT`/`LOG_CONSOLE_LEVEL`/`LOG_OTEL_LEVEL`;
`pkg/profiling` reads `PYROSCOPE_SERVER_ADDRESS`. To change:

1. `OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER` parsed in `pkg/config.OTel`; `OTEL_METRICS_ENABLED`
   joins the alias list.
2. `otelsetup` exports logs to the primary collector (today debug collector only), filtered at
   `LOG_OTEL_LEVEL`.
3. A Prometheus reader (`go.opentelemetry.io/otel/exporters/prometheus`) on its own listener at
   `OTEL_EXPORTER_PROMETHEUS_PORT` when `prometheus` is listed.
4. aigateway's own `/metrics` moves off the public router behind the same switch, port and bearer
   (security review: Opus high).
5. `GATEWAY_LOG_LEVEL` and `GATEWAY_OTEL_DEFAULT_ENDPOINT` join the alias list with a `removeIn`.

## 10. Open questions, each with a recommendation

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                        | Recommendation                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | "On by default" with no collector set?                                                                                                                                                                                                                                                                                                                                                                          | ✅ On once `OTEL_EXPORTER_OTLP_ENDPOINT` is set; unset exports nothing. A guessed localhost floods logs with connection errors.                                   |
| Q2  | Pull switch: standard `OTEL_METRICS_EXPORTER=otlp,prometheus` + `OTEL_EXPORTER_PROMETHEUS_PORT`, or LangWatch `LANGWATCH_PROMETHEUS_ENABLED` + `_PORT`?                                                                                                                                                                                                                                                         | ✅ Standard. The spec allows a comma list; Go and Node exporters know these names.                                                                                |
| Q3  | Where the door listens: own port `9464`, or today's health door (api port, worker 2999)? Keep main's location during the alias window?                                                                                                                                                                                                                                                                          | ✅ Own port, never public. ✅ Keep the old location only while `METRICS_API_KEY` is set and `OTEL_METRICS_EXPORTER` is not, with a warning, until the aliases go. |
| Q4  | Scrape bearer name: main's `METRICS_API_KEY` or the branch's `LANGWATCH_METRICS_TOKEN`?                                                                                                                                                                                                                                                                                                                         | ✅ `METRICS_API_KEY`: every main install and chart already has it; the branch name never shipped. Keep fail-closed in production.                                 |
| Q5  | AWS SDK, OpenAI and ioredis instrumentations patch modules, so they must load first. The record rules preload out of scope (`ARCHITECTURE.md:805-808`). (a) accept the loss; (b) one preload `node --import @langwatch/observability/register` in the image start command, honouring `OTEL_NODE_ENABLED_INSTRUMENTATIONS` / `OTEL_NODE_DISABLED_INSTRUMENTATIONS`; (c) hand-written spans in the owning clients | ✅ (b), default list = main's (aws-sdk, openai), ioredis opt-in. Reopens a ruling, so Alex decides. Detectors and runtime-node land now either way.               |
| Q6  | Logs on by default ship to collectors with no logs pipeline, and main's `LOG_OTEL_LEVEL` default was `debug`                                                                                                                                                                                                                                                                                                    | ✅ Accept with the upgrade note; `LOG_OTEL_LEVEL` defaults to `LOG_LEVEL` (`info`) to bound volume. haven keeps setting `debug` locally.                          |
| Q7  | Alias window length                                                                                                                                                                                                                                                                                                                                                                                             | ✅ Until the LTS floor passes the first release with the new names; conflict = boot error; a test enforces `removeIn`.                                            |
| Q8  | langevals has no OTel of its own                                                                                                                                                                                                                                                                                                                                                                                | ✅ `LOG_LEVEL` at its entrypoint now; park OTel (it would come from `opentelemetry-instrument`, same names).                                                      |
| Q9  | `WORKER_METRICS_PORT` is the worker's health port                                                                                                                                                                                                                                                                                                                                                               | ✅ Leave it (chart probes key on it); park a `WORKER_HEALTH_PORT` rename.                                                                                         |
| Q10 | aigateway `/metrics` on the public router                                                                                                                                                                                                                                                                                                                                                                       | ✅ Verify its auth first; move behind the switch and port in the Go slice.                                                                                        |

## 11. Slices once ruled

1. **TS reader** (`packages/process/src/observability-owner.ts`, `packages/observability/src/node/*`):
   new names, alias table + conflict error, sampler, service name, two metric readers, own listener,
   detectors, runtime-node, profiling. Touches a secret and a scrape gate: Opus high, reviewed.
2. **Adopters**: apps/tasks, apps/scenario-child, apps/server read the owner slice; delete
   `loggerConfigurationFrom` and the server CLI mapper; delete ops' unused `metricsApiKey` leaf.
3. **Go**: section 9.
4. **Surfaces**: haven overlay (`tools/thuishaven/domain/overlay.go:304-340`), `.env.example`,
   chart helpers (`_helpers.tpl:1068-1074`, scrape config to the new port), public docs page.
5. **Record**: the `ARCHITECTURE.md` paragraph at lines 809-814 replaced (coordinator).
6. **Instrumentations** that patch modules, after Q5.
