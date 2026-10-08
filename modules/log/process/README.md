# @langwatch/log-process

The server half of [log](../README.md). Logs: receiving OTLP logs, canonicalising and recording them, and reading a trace's logs.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("log").withRepositories(logRepositories).withApi(LogModule).withTransports(otlpLogsRest).withEventing(logEventing)`, `src/log.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`LogApi`)

The portable canonical log capability shared by process features.

Peers call these through the token, declared at `../contract/src/log.api.ts:35`; nothing else in this package is public.

#### `prepareCanonicalLogRecords`

```typescript
prepareCanonicalLogRecords(input: { tenantId: string; organizationId: string; request: unknown; piiRedactionLevel: LogPiiRedactionLevel; acceptedAt?: number; }): Promise<LogPreparation>;
```

#### `receiveOtlpLogs`

One exporter request at the logs door: key, allowance, parse, then collection.

```typescript
receiveOtlpLogs(request: OtlpDoorRequest): Promise<LogOtlpDoorResult>;
```

#### `collectOtlpLogs`

Prepares and records one OTLP log export, for a receiver that authenticated it itself.

```typescript
collectOtlpLogs(input: LogCollectionInput): Promise<LogRequestCollectionResult>;
```

#### `recordCanonicalLogRecords`

Sends prepared records onto the `log_processing` pipeline for durable storage.

```typescript
recordCanonicalLogRecords(records: readonly CanonicalLogRecord[]): Promise<void>;
```

## REST transport

### `otlpLogsRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/otlp-logs.rest.ts:30`   |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `POST /api/otel/v1/logs` · `ingestOtlpLogs`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-logs.rest.ts:35`.

Answers at `/api/otel/v1/logs`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-logs.rest.ts:36)
// Response: inline, src/transport/otlp-logs.rest.ts:39
type Response = unknown;
```

#### `POST /:otlpBase{.+}/v1/logs` · `ingestOtlpLogsAlias`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-logs.rest.ts:55`.

Answers at `/:otlpBase{.+}/v1/logs`.

```typescript
// Params: otlpLogAliasParamsSchema, ../contract/src/log.api.ts:24
interface Params {
  otlpBase: string;
}
// Rawbody: "bytes" (inline, src/transport/otlp-logs.rest.ts:57)
// Response: inline, src/transport/otlp-logs.rest.ts:60
type Response = unknown;
```

#### `POST /:otlpBase{.+}/v1/logs/` · `ingestOtlpLogsAliasSlash`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-logs.rest.ts:74`.

Answers at `/:otlpBase{.+}/v1/logs/`.

```typescript
type Params = z.infer<typeof otlpLogAliasParamsSchema>; // ../contract/src/log.api.ts:24
// Rawbody: "bytes" (inline, src/transport/otlp-logs.rest.ts:76)
// Response: inline, src/transport/otlp-logs.rest.ts:79
type Response = unknown;
```

#### `POST /v1/logs` · `ingestOtlpLogsRootV1`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-logs.rest.ts:93`.

Answers at `/v1/logs`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-logs.rest.ts:94)
// Response: inline, src/transport/otlp-logs.rest.ts:97
type Response = unknown;
```

#### `POST /v1/logs/` · `ingestOtlpLogsRootV1Slash`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-logs.rest.ts:111`.

Answers at `/v1/logs/`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-logs.rest.ts:112)
// Response: inline, src/transport/otlp-logs.rest.ts:115
type Response = unknown;
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `log_processing` (aggregate `log`)

Declared at `src/eventing/log.pipeline.ts:50`. Events: `canonicalLogRecordReceivedEventSchema`.

| Kind                      | Name                                                                                           | Handles | Declared at                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------- | --------------------------------- |
| command                   | `recordLogRecord`                                                                              | –       | `src/eventing/log.pipeline.ts:65` |
| ClickHouse map projection | `≈ CanonicalLogStorageMapProjection.create({ store: deps.canonicalLogAppendStore, shardCount…` | –       | `src/eventing/log.pipeline.ts:55` |
| retention                 | `≈ deps.retention`                                                                             | –       | `src/eventing/log.pipeline.ts:62` |

## Configuration

| Kind   | Leaf               | Environment variable    | Declared at                       |
| ------ | ------------------ | ----------------------- | --------------------------------- |
| config | `processingShards` | `LOG_PROCESSING_SHARDS` | `../contract/src/log.config.ts:9` |

<!-- readme:generated:end -->
