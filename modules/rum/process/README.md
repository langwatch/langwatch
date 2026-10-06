# @langwatch/rum-process

The server half of [rum](../README.md). The platform's own browser telemetry, proxied to its collector (ADR-058).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("rum").withRepositories(rumRepositories).withApi(RumModule).withTransports(rumRest)`, `src/rum.module.ts:7`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`RumApi`)

The platform's own browser telemetry, proxied to its collector (ADR-058).

Peers call these through the token, declared at `../contract/src/rum.api.ts:22`; nothing else in this package is public.

#### `ingestBrowserTraces`

Validates and forwards one export; a refusal is a `rum_*` handled error.

```typescript
ingestBrowserTraces(report: BrowserTraceReport): Promise<void>;
```

## REST transport

### `rumRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/rum.rest.ts:19`         |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `POST /api/rum/v1/traces` · `ingestBrowserTraces`

Report the platform's own browser traces

Public: browser telemetry ingest; the browser has no credential to present and the payload is treated as untrusted. Declared at `src/transport/rum.rest.ts:24`.

Answers at `/api/rum/v1/traces`.

```typescript
// Rawbody: "text" (inline, src/transport/rum.rest.ts:25)
type Headers = z.infer<typeof rumReportHeadersSchema>; // ../contract/src/rum.api.ts:6
// Response: "protocol" (inline, src/transport/rum.rest.ts:38)
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: rum declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf                | Environment variable          | Declared at                        |
| ------ | ------------------- | ----------------------------- | ---------------------------------- |
| secret | `–`                 | `RUM_COLLECTOR_HEADERS`       | `src/app/rum.app.ts:34`            |
| config | `enabled`           | `RUM_ENABLED`                 | `../contract/src/rum.config.ts:14` |
| config | `sampleRatio`       | `RUM_SAMPLE_RATIO`            | `../contract/src/rum.config.ts:21` |
| config | `collectorEndpoint` | `RUM_COLLECTOR_ENDPOINT`      | `../contract/src/rum.config.ts:25` |
| config | `telemetryEndpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | `../contract/src/rum.config.ts:29` |

<!-- readme:generated:end -->
