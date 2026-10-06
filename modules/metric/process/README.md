# @langwatch/metric-process

The server half of [metric](../README.md). Metrics: receiving OTLP metrics, canonicalising and recording their data points.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("metric").withRepositories(metricRepositories).withApi(MetricModule).withTransports(otlpMetricsRest).withEventing(metricEventing)`, `src/metric.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`MetricApi`)

Peers call these through the token, declared at `../contract/src/metric.api.ts:52`; nothing else in this package is public.

#### `prepareMetricDataPoints`

```typescript
prepareMetricDataPoints(input: { tenantId: string; organizationId: string; request: unknown; piiRedactionLevel: MetricPiiRedactionLevel; acceptedAt?: number; }): Promise<MetricDataPointPreparation>;
```

#### `receiveOtlpMetrics`

One exporter request at the metrics door: key, allowance, parse, then collection.

```typescript
receiveOtlpMetrics(request: OtlpDoorRequest): Promise<MetricOtlpDoorResult>;
```

#### `collectOtlpMetrics`

Prepares and records one OTLP metric export, for a receiver that authenticated it itself.

```typescript
collectOtlpMetrics(input: MetricCollectionInput): Promise<MetricRequestCollectionResult>;
```

#### `recordCanonicalMetricDataPoints`

Sends prepared points onto the `metric_processing` pipeline for durable storage.

```typescript
recordCanonicalMetricDataPoints(points: readonly CanonicalMetricDataPoint[]): Promise<void>;
```

## REST transport

### `otlpMetricsRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/otlp-metrics.rest.ts:30` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | project                                 |

#### `POST /api/otel/v1/metrics` · `ingestOtlpMetrics`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-metrics.rest.ts:35`.

Answers at `/api/otel/v1/metrics`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-metrics.rest.ts:36)
// Response: "protocol" (inline, src/transport/otlp-metrics.rest.ts:39)
```

#### `POST /:otlpBase{.+}/v1/metrics` · `ingestOtlpMetricsAlias`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-metrics.rest.ts:55`.

Answers at `/:otlpBase{.+}/v1/metrics`.

```typescript
type Params = z.infer<typeof otlpMetricAliasParamsSchema>; // ../contract/src/metric.api.ts:42
// Rawbody: "bytes" (inline, src/transport/otlp-metrics.rest.ts:57)
// Response: "protocol" (inline, src/transport/otlp-metrics.rest.ts:60)
```

#### `POST /:otlpBase{.+}/v1/metrics/` · `ingestOtlpMetricsAliasSlash`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-metrics.rest.ts:74`.

Answers at `/:otlpBase{.+}/v1/metrics/`.

```typescript
type Params = z.infer<typeof otlpMetricAliasParamsSchema>; // ../contract/src/metric.api.ts:42
// Rawbody: "bytes" (inline, src/transport/otlp-metrics.rest.ts:76)
// Response: "protocol" (inline, src/transport/otlp-metrics.rest.ts:79)
```

#### `POST /:otlpBase{.+}/v1//metrics` · `ingestOtlpMetricsAliasDoubled`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-metrics.rest.ts:94`.

Answers at `/:otlpBase{.+}/v1//metrics`.

```typescript
type Params = z.infer<typeof otlpMetricAliasParamsSchema>; // ../contract/src/metric.api.ts:42
// Rawbody: "bytes" (inline, src/transport/otlp-metrics.rest.ts:96)
// Response: "protocol" (inline, src/transport/otlp-metrics.rest.ts:99)
```

#### `POST /v1/metrics` · `ingestOtlpMetricsRootV1`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-metrics.rest.ts:113`.

Answers at `/v1/metrics`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-metrics.rest.ts:114)
// Response: "protocol" (inline, src/transport/otlp-metrics.rest.ts:117)
```

#### `POST /v1/metrics/` · `ingestOtlpMetricsRootV1Slash`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-metrics.rest.ts:131`.

Answers at `/v1/metrics/`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-metrics.rest.ts:132)
// Response: "protocol" (inline, src/transport/otlp-metrics.rest.ts:135)
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `metric_processing` (aggregate `metric`)

Declared at `src/eventing/metric.pipeline.ts:61`. Events: `metricDataPointReceivedEventSchema`.

| Kind                      | Name                                                                                           | Handles | Declared at                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------- | ------------------------------------ |
| command                   | `recordDataPoint`                                                                              | –       | `src/eventing/metric.pipeline.ts:90` |
| ClickHouse map projection | `≈ MetricDataPointStorageMapProjection.create({ store: deps.metricDataPointAppendStore, shar…` | –       | `src/eventing/metric.pipeline.ts:68` |
| ClickHouse map projection | `≈ MetricSeriesCatalogMapProjection.create({ store: deps.metricSeriesCatalogAppendStore, sha…` | –       | `src/eventing/metric.pipeline.ts:74` |
| ClickHouse map projection | `≈ MetricTimeRollupMapProjection.create({ store: deps.metricTimeRollupAppendStore, shardCoun…` | –       | `src/eventing/metric.pipeline.ts:80` |
| retention                 | `≈ deps.retention`                                                                             | –       | `src/eventing/metric.pipeline.ts:87` |

## Configuration

| Kind   | Leaf               | Environment variable       | Declared at                        |
| ------ | ------------------ | -------------------------- | ---------------------------------- |
| config | `processingShards` | `METRIC_PROCESSING_SHARDS` | `../contract/src/metric.api.ts:76` |

<!-- readme:generated:end -->
