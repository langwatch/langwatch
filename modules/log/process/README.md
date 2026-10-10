# @langwatch/log-process

The server half of [log](../README.md). Logs: receiving OTLP logs, canonicalising and recording them, and reading a trace's logs.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("log").withRepositories(logRepositories).withApi(LogModule).withTransports(otlpLogsRest).withEventing(logEventing).withDoors(…)`, `src/log.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`LogApi`)

The portable canonical log capability shared by process features.

Peers call these through the token, declared at `../contract/src/log.api.ts:32`; nothing else in this package is public.

#### `prepareCanonicalLogRecords`

```typescript
prepareCanonicalLogRecords(input: { tenantId: string; organizationId: string; request: unknown; piiRedactionLevel: LogPiiRedactionLevel; acceptedAt?: number; }): Promise<LogPreparation>;
```

#### `receiveOtlpLogs`

One exporter request the logs door verified: allowance, parse, then collection.

```typescript
receiveOtlpLogs(input: { request: OtlpDoorRequest; credential: OtlpIngestCredential; }): Promise<LogOtlpDoorResult>;
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
| Declared at | `src/transport/otlp-logs.rest.ts:115`  |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | otlp_ingest                            |

#### `POST /api/otel/v1/logs` · `ingestOtlpLogs`

Authenticated: the OTLP ingest door's resolved key is the whole gate, as on main. Credential `otlp_ingest`. Hidden from the OpenAPI document. Declared at `src/transport/otlp-logs.rest.ts:121`.

Answers at `/api/otel/v1/logs`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-logs.rest.ts:123)
// Response: inline, src/transport/otlp-logs.rest.ts:126
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
