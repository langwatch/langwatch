# @langwatch/metric-process

The server half of [metric](../README.md). Metrics: receiving OTLP metrics, canonicalising and recording their data points.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("metric").withRepositories(metricRepositories).withApi(MetricModule).withTransports(otlpMetricsRest).withEventing(metricEventing).withDoors(…)`, `src/metric.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`MetricApi`)

Peers call these through the token, declared at `../contract/src/metric.api.ts:48`; nothing else in this package is public.

#### `prepareMetricDataPoints`

```typescript
prepareMetricDataPoints(input: { tenantId: string; organizationId: string; request: unknown; piiRedactionLevel: MetricPiiRedactionLevel; acceptedAt?: number; }): Promise<MetricDataPointPreparation>;
```

#### `receiveOtlpMetrics`

One exporter request the metrics door verified: allowance, parse, then collection.

```typescript
receiveOtlpMetrics(input: { request: OtlpDoorRequest; credential: OtlpIngestCredential; }): Promise<MetricOtlpDoorResult>;
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

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/otlp-metrics.rest.ts:115` |
| Base URL    | none: each route's path is its address   |
| Addressing  | literal                                  |
| Credential  | otlp_ingest                              |

#### `POST /api/otel/v1/metrics` · `ingestOtlpMetrics`

Authenticated: the OTLP ingest door's resolved key is the whole gate, as on main. Credential `otlp_ingest`. Hidden from the OpenAPI document. Declared at `src/transport/otlp-metrics.rest.ts:121`.

Answers at `/api/otel/v1/metrics`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-metrics.rest.ts:123)
// Response: inline, src/transport/otlp-metrics.rest.ts:126
type Response = unknown;
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

| Kind   | Leaf               | Environment variable       | Declared at                           |
| ------ | ------------------ | -------------------------- | ------------------------------------- |
| config | `processingShards` | `METRIC_PROCESSING_SHARDS` | `../contract/src/metric.config.ts:10` |

<!-- readme:generated:end -->
