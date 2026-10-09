# ADR-175: LangWatch's own telemetry is configured by the standard OTel environment, plus one log level

**Date:** 2026-10-09

**Status:** Accepted (Alex, 2026-10-09: Q1-Q10 as recommended in the plan, section 10)

> One line: every LangWatch process exports traces, logs and metrics over OTLP whenever
> `OTEL_EXPORTER_OTLP_ENDPOINT` is set, switched per signal by the standard `OTEL_*_EXPORTER` names;
> a Prometheus `/metrics` door is off by default and is one more value on `OTEL_METRICS_EXPORTER`
> plus a port; logs take one `LOG_LEVEL` with two optional per-sink overrides; main's older names are
> read as deprecated aliases with a warning until the supported upgrade window no longer needs them.

Plan, inventory and before/after tables: `dev/docs/plans/telemetry-env-2026-10-09.md`.

## Context

- Alex (2026-10-09): make logging, tracing, profiling and metrics configuration less confusing; OTel
  fully on by default; a metrics endpoint for Prometheus to pull, off by default.
- Today the TS processes, the Go services and langevals read four log-level families
  (`PINO_LOG_LEVEL`, `LOG_LEVEL`, `_LOG_LEVEL`, `GATEWAY_LOG_LEVEL`), two scrape-bearer names
  (`METRICS_API_KEY`, `LANGWATCH_METRICS_TOKEN`), two non-standard export switches
  (`PINO_OTEL_ENABLED`, `OTEL_METRICS_ENABLED`, with opposite defaults on main and this branch) and a
  metrics mode that turns the OTLP push off when Prometheus is chosen.
- `dev/docs/ARCHITECTURE.md:809-814` rules metrics transport a binary knob defaulting to
  `prometheus`; the code defaults to `otlp`. The record and the code disagree.
- apps/tasks and scenario-child read no telemetry configuration; api and worker ignore
  `OTEL_SERVICE_NAME`; TS never starts the profiler and registers no instrumentations or resource
  detectors, all of which main did.
- The Go side (`pkg/config/otel.go`) already reads the standard names, keeps deprecated aliases with a
  boot warning, and refuses to boot when an alias and its standard name disagree. It is the precedent.

## Decision

1. **Standard names first.** Where the OpenTelemetry specification names a variable, LangWatch reads
   that name and no other: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (a secret,
   ADR-132), the per-signal endpoint and header variants, `OTEL_EXPORTER_OTLP_PROTOCOL`,
   `OTEL_SDK_DISABLED`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER`,
   `OTEL_TRACES_SAMPLER_ARG`, `OTEL_{TRACES,METRICS,LOGS}_EXPORTER`, `OTEL_EXPORTER_PROMETHEUS_PORT`
   and `_HOST`. The `OTEL_*` namespace configures LangWatch's own telemetry only, never customer trace
   routing.
2. **On by default, behind the one endpoint.** Each signal's exporter defaults to `otlp`; with no
   endpoint set nothing is exported and no localhost is guessed.
3. **Prometheus pull is additive.** `OTEL_METRICS_EXPORTER=otlp,prometheus` adds a pull reader to
   the same `MeterProvider`; the push keeps running. The door listens on its own port (default
   `9464`), never the public one. Its bearer is `METRICS_API_KEY`; in production an unset key leaves
   the door unmounted with one boot error, as on main.
4. **One log level.** `LOG_LEVEL` sets every sink; `LOG_CONSOLE_LEVEL` and `LOG_OTEL_LEVEL` override
   one sink each and default to `LOG_LEVEL`. `LOG_FORMAT` stays. TS, Go and langevals read the same
   names.
5. **Profiling** is on when `PYROSCOPE_SERVER_ADDRESS` is set, in every long-running process.
6. **Instrumentation without patching is on by default**: `envDetector`, `awsEksDetector`,
   runtime-node metrics and trace ids on log records. Instrumentations that patch modules wait on the
   preload question below.
7. **One reader per language.** TS: the `observabilityOwner` slice, read by api, worker, tasks,
   scenario-child and the server CLI through one mapper. Go: `pkg/config.OTel` and `pkg/clog`.
8. **Old names are aliases with an end.** Names main shipped (`PINO_LOG_LEVEL`, `_LOG_LEVEL`,
   `PINO_CONSOLE_LEVEL`, `PINO_OTEL_LEVEL`, `PINO_OTEL_ENABLED`, `OTEL_METRICS_ENABLED`,
   `GATEWAY_LOG_LEVEL`, `OTEL_OTLP_ENDPOINT`, `OTEL_OTLP_HEADERS`, `OTEL_SAMPLE_RATIO`,
   `OTEL_TRACE_REDIS_COMMANDS`) are read through one alias table per language. Each use warns once at
   boot naming the replacement and the removal release; an alias and its new name set to different
   values is a boot error; a test fails when a row reaches its removal release. Names that never
   shipped on main (`LANGWATCH_METRICS_MODE`, `LANGWATCH_METRICS_TOKEN`) are deleted outright.

## Open for Alex

- **Preload for patching instrumentations.** AWS SDK, OpenAI and ioredis instrumentation (on by
  default on main, ioredis opt-in) must load before the modules they patch, which
  `ARCHITECTURE.md:805-808` rules out of scope. Recommended: one preload entry,
  `node --import @langwatch/observability/register`, in the images' start command, honouring
  `OTEL_NODE_ENABLED_INSTRUMENTATIONS` / `OTEL_NODE_DISABLED_INSTRUMENTATIONS`. Alternatives: accept
  the loss, or hand-written spans in the owning clients.
- **Legacy `/metrics` location** during the alias window (recommended: kept while `METRICS_API_KEY`
  is set and `OTEL_METRICS_EXPORTER` is not).
- The plan's section 10 lists the rest, each with a recommendation.

## Consequences

- A self-hoster who already set `OTEL_EXPORTER_OTLP_ENDPOINT` for traces now also sends logs and
  metrics there. The upgrade note says so and names `OTEL_LOGS_EXPORTER=none` and
  `OTEL_METRICS_EXPORTER=none`.
- `LOG_OTEL_LEVEL` no longer defaults to `debug`; collector log volume follows `LOG_LEVEL`.
- Dashboards keyed on `service.name=langwatch-app` / `langwatch-workers` work again, because the chart's
  `OTEL_SERVICE_NAME` is honoured.
- The record paragraph on the metrics binary knob is replaced; the Go services gain primary-collector
  log export and a pull reader; aigateway's public `/metrics` moves behind the switch.
- haven, `.env.example`, the Helm chart and the public docs switch to the new names in the same
  release; the aliases cover anything they miss.

## Alternatives considered

- **LangWatch-named switches** (`LANGWATCH_PROMETHEUS_ENABLED`, `LANGWATCH_LOGS_EXPORT`): clearer
  to read, but a second vocabulary beside the one every OTel SDK and collector document already uses.
- **Keep the binary metrics mode**: one fewer listener, but choosing Prometheus silently drops the
  push, which is the confusion this record removes.
- **Serve `/metrics` on the existing health door**: no new port, but the api's health door is its
  public port, so the door's safety would rest on ingress rules alone.
- **Rename every LangWatch-only name under `LANGWATCH_`** (including `LOG_LEVEL`): consistent, but
  churns the one name Go and langevals already share.

## References

- `dev/docs/plans/telemetry-env-2026-10-09.md`
- ADR-003 (logging), ADR-042 (local observability stack, debug collector), ADR-132 (secrets)
- `dev/docs/ARCHITECTURE.md` lines 796-830 (process preamble, telemetry, metrics)
- `pkg/config/otel.go` (alias and conflict precedent)
