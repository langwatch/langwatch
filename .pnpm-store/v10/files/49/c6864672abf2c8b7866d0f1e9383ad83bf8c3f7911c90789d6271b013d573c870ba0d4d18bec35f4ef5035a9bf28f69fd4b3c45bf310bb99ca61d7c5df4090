# OpenTelemetry Declarative Configuration

[![NPM Published Version][npm-img]][npm-url]
[![Apache License][license-image]][license-image]

**Note: This is an experimental package under active development. New releases may include breaking changes.**

This package implements the [OpenTelemetry declarative configuration](https://github.com/open-telemetry/opentelemetry-configuration) specification for Node.js. It parses configuration from a YAML file or environment variables and produces a `ConfigurationModel` that the OpenTelemetry SDK uses to initialize providers.

## Installation

```sh
npm install @opentelemetry/configuration
```

## Usage

`createConfigFactory()` selects the configuration source automatically:

- If `OTEL_CONFIG_FILE` points to a valid `.yaml`/`.yml` file, configuration is read from that file.
- Otherwise, configuration is assembled from standard OpenTelemetry environment variables.

```typescript
import { createConfigFactory } from '@opentelemetry/configuration';

const factory = createConfigFactory();
const config = factory.getConfigModel();
```

### YAML file configuration

Set `OTEL_CONFIG_FILE` to the path of your configuration file:

```sh
OTEL_CONFIG_FILE=./otel-config.yaml node app.js
```

Example:

```yaml
file_format: "1.0"
resource:
  attributes:
    - name: service.name
      value: my-service
tracer_provider:
  processors:
    - batch:
        exporter:
          otlp_http:
            endpoint: http://localhost:4318/v1/traces
```

Environment variable substitution is supported using `${VAR_NAME}`, `${VAR_NAME:-default}`, `${env:VAR_NAME}`, and `${env:VAR_NAME:-default}` syntax. Use `$$` for a literal `$`.

```yaml
tracer_provider:
  processors:
    - batch:
        exporter:
          otlp_http:
            endpoint: ${OTEL_EXPORTER_ENDPOINT:-http://localhost:4318}/v1/traces
```

### Environment variable configuration

When no config file is set, the factory reads from the standard OpenTelemetry SDK environment variables. The full set of variables this package consumes:

| Variable | Description |
| --- | --- |
| `OTEL_SDK_DISABLED` | Disable the SDK entirely |
| `OTEL_LOG_LEVEL` | Internal SDK log level |
| `OTEL_SERVICE_NAME` | Service name resource attribute |
| `OTEL_RESOURCE_ATTRIBUTES` | Comma-separated resource attributes |
| `OTEL_NODE_RESOURCE_DETECTORS` | Resource detectors to enable (`env`, `host`, `os`, `process`, `serviceinstance`, `all`, `none`) |
| `OTEL_PROPAGATORS` | Propagators: `tracecontext`, `baggage`, `b3`, `b3multi` |
| `OTEL_TRACES_EXPORTER` | Traces exporter(s): `otlp`, `console`, `none` |
| `OTEL_METRICS_EXPORTER` | Metrics exporter(s): `otlp`, `prometheus`, `console`, `none` |
| `OTEL_LOGS_EXPORTER` | Logs exporter(s): `otlp`, `console`, `none` |
| `OTEL_TRACES_SAMPLER` | Sampler name (e.g. `parentbased_always_on`, `traceidratio`) |
| `OTEL_TRACES_SAMPLER_ARG` | Sampler argument (e.g. ratio value) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (all signals) |
| `OTEL_EXPORTER_OTLP_HEADERS` | OTLP headers (all signals) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | OTLP protocol: `grpc`, `http/protobuf`, `http/json` |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | OTLP request timeout (all signals) |
| `OTEL_EXPORTER_OTLP_COMPRESSION` | OTLP compression (all signals): `gzip`, `none` |
| `OTEL_EXPORTER_OTLP_CERTIFICATE` | OTLP server CA certificate file (all signals) |
| `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE` | OTLP client certificate file for mTLS (all signals) |
| `OTEL_EXPORTER_OTLP_CLIENT_KEY` | OTLP client private key file for mTLS (all signals) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Per-signal override (traces) |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | Per-signal override (traces) |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | Per-signal override (traces) |
| `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` | Per-signal override (traces) |
| `OTEL_EXPORTER_OTLP_TRACES_COMPRESSION` | Per-signal override (traces) |
| `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE` | Per-signal override (traces) |
| `OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE` | Per-signal override (traces) |
| `OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY` | Per-signal override (traces) |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Per-signal override (metrics) |
| `OTEL_EXPORTER_OTLP_METRICS_HEADERS` | Per-signal override (metrics) |
| `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | Per-signal override (metrics) |
| `OTEL_EXPORTER_OTLP_METRICS_TIMEOUT` | Per-signal override (metrics) |
| `OTEL_EXPORTER_OTLP_METRICS_COMPRESSION` | Per-signal override (metrics) |
| `OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE` | Per-signal override (metrics) |
| `OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE` | Per-signal override (metrics) |
| `OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY` | Per-signal override (metrics) |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | Metric temporality preference: `cumulative`, `delta`, `lowmemory` |
| `OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION` | Default histogram aggregation: `explicit_bucket_histogram`, `base2_exponential_bucket_histogram` |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Per-signal override (logs) |
| `OTEL_EXPORTER_OTLP_LOGS_HEADERS` | Per-signal override (logs) |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | Per-signal override (logs) |
| `OTEL_EXPORTER_OTLP_LOGS_TIMEOUT` | Per-signal override (logs) |
| `OTEL_EXPORTER_OTLP_LOGS_COMPRESSION` | Per-signal override (logs) |
| `OTEL_EXPORTER_OTLP_LOGS_CERTIFICATE` | Per-signal override (logs) |
| `OTEL_EXPORTER_OTLP_LOGS_CLIENT_CERTIFICATE` | Per-signal override (logs) |
| `OTEL_EXPORTER_OTLP_LOGS_CLIENT_KEY` | Per-signal override (logs) |
| `OTEL_EXPORTER_PROMETHEUS_HOST` | Prometheus exporter bind host |
| `OTEL_EXPORTER_PROMETHEUS_PORT` | Prometheus exporter bind port |
| `OTEL_METRIC_EXPORT_INTERVAL` | Periodic metric reader export interval (ms) |
| `OTEL_METRIC_EXPORT_TIMEOUT` | Periodic metric reader export timeout (ms) |
| `OTEL_METRICS_EXEMPLAR_FILTER` | Exemplar filter: `always_on`, `always_off`, `trace_based` |
| `OTEL_BSP_SCHEDULE_DELAY` | Batch span processor: schedule delay (ms) |
| `OTEL_BSP_EXPORT_TIMEOUT` | Batch span processor: export timeout (ms) |
| `OTEL_BSP_MAX_QUEUE_SIZE` | Batch span processor: max queue size |
| `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | Batch span processor: max export batch size |
| `OTEL_BLRP_SCHEDULE_DELAY` | Batch log record processor: schedule delay (ms) |
| `OTEL_BLRP_EXPORT_TIMEOUT` | Batch log record processor: export timeout (ms) |
| `OTEL_BLRP_MAX_QUEUE_SIZE` | Batch log record processor: max queue size |
| `OTEL_BLRP_MAX_EXPORT_BATCH_SIZE` | Batch log record processor: max export batch size |
| `OTEL_ATTRIBUTE_COUNT_LIMIT` | Default max attributes per span/log/event/link |
| `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT` | Default max attribute value length |
| `OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT` | Max attributes per span |
| `OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT` | Max span attribute value length |
| `OTEL_SPAN_EVENT_COUNT_LIMIT` | Max events per span |
| `OTEL_SPAN_LINK_COUNT_LIMIT` | Max links per span |
| `OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT` | Max attributes per span event |
| `OTEL_LINK_ATTRIBUTE_COUNT_LIMIT` | Max attributes per span link |
| `OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT` | Max attributes per log record |
| `OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT` | Max log record attribute value length |

See [`src/EnvironmentConfigFactory.ts`](src/EnvironmentConfigFactory.ts) for the exact parsing logic.

## Development

### Generated files

`src/generated/` is auto-generated — do not edit manually. It contains:

- `types.ts` — TypeScript interfaces derived from the JSON schema (via `json-schema-to-typescript`)
- `validator.js` — Pre-compiled ajv validator (ahead-of-time compiled from the schema at build time; eliminates runtime `ajv.compile()`)
- `validator.d.ts` — TypeScript declarations for `validator.js`

### Regenerating after a schema version bump

1. Update the `CONFIG_VERSION` constant in `scripts/generate-config.js`
2. Run from this package directory:

   ```sh
   npm run generate:config
   ```

3. Review the diff in `src/generated/types.ts` and `src/generated/validator.js`
4. Update `SUPPORTED_FILE_FORMAT_MAJOR` / `SUPPORTED_FILE_FORMAT_MINOR` in `src/FileConfigFactory.ts` if the new schema version is outside the currently-supported range
5. Update `EnvironmentConfigFactory.ts` and `utils.ts` if new fields need env var mapping

The generation script (`scripts/generate-config.js`) handles several post-processing steps:

- Renames the root type from `OpenTelemetryConfiguration` to `ConfigurationModel`
- Makes `file_format` optional (required at parse time but not needed when constructing the model in code)
- Removes the duplicate type declarations that `json-schema-to-typescript` emits for structurally-identical sub-schemas (e.g. the second `GrpcTls`/`HttpTls`)
- Produces a pre-compiled ajv validator (`validator.js` + `validator.d.ts`) for use at runtime

### Defaults

Both config paths apply the same spec-defined defaults so consumers see consistent behaviour regardless of config source:

| Field | Default |
| --- | --- |
| `disabled` | `false` |
| `log_level` | `info` |
| `attribute_limits.attribute_count_limit` | `128` |

`FileConfigFactory` applies these via `applyConfigDefaults()` after schema validation. `EnvironmentConfigFactory` applies them via `initializeDefaultConfiguration()` in the constructor, then overlays env var values on top.

One intentional exception in both paths: `AttributeNameValue.type` is **not** defaulted even though the spec says "if omitted, string is used". This is a semantic default for SDK code interpreting resource attributes, not a config-parser concern. SDK code reading `resource.attributes` should apply `attr.type ?? 'string'` at the point of use.

## Supported schema versions

- `1.0`
- `1.1`

For a per-field view of which schema fields the SDK currently applies, see
the JS row in the cross-SDK [language support status][lss] doc maintained in
the `opentelemetry-configuration` repo. That doc is the source of truth for
declarative-config conformance across all SDKs.

[lss]: https://github.com/open-telemetry/opentelemetry-configuration/blob/main/language-support-status.md#js-

## Useful links

- [OpenTelemetry Declarative Configuration Specification](https://github.com/open-telemetry/opentelemetry-configuration)
- [OpenTelemetry for Node.js](https://github.com/open-telemetry/opentelemetry-js)
- [OpenTelemetry Community](https://opentelemetry.io/)

## License

Apache 2.0 - See [LICENSE][license-url] for more information.

[npm-url]: https://www.npmjs.com/package/@opentelemetry/configuration
[npm-img]: https://badge.fury.io/js/%40opentelemetry%2Fconfiguration.svg
[license-url]: https://github.com/open-telemetry/opentelemetry-js/blob/main/LICENSE
[license-image]: https://img.shields.io/badge/license-Apache_2.0-green.svg?style=flat
