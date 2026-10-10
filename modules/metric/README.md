# metric

Metrics: receiving OTLP metrics, canonicalising and recording their data points.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                  |
| Subjects       | metric, metric-ingestion                                                                         |
| Halves         | [contract](contract) · [process](process/README.md)                                              |
| Api token      | `MetricApi` = `moduleApi<MetricApi>()("metric")`, `contract/src/metric.api.ts:67` (4 operations) |
| Installed by   | api, worker, tasks (process)                                                                     |

## What metric owns

| Kind                      | Name                                          | Declared at                                                                                 |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `metric_data_points`                          | `process/src/repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts:203` |
| ClickHouse table (writes) | `metric_usage_estimates`                      | `process/src/repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts:209` |
| ClickHouse table (writes) | `metric_series`                               | `process/src/repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts:262` |
| ClickHouse table (writes) | `metric_time_rollups`                         | `process/src/repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts:315` |
| Stores required           | clickhouse                                    | `process/src/repositories/live/live.metric.repositories.ts:9`                               |
| Config                    | `processingShards` (METRIC_PROCESSING_SHARDS) | `contract/src/metric.config.ts:10`                                                          |

Anything else metric needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token              | Module                                        |
| ------------- | ------------------ | --------------------------------------------- |
| `dataPrivacy` | `DataPrivacyApi`   | [data-privacy](../data-privacy/README.md)     |
| `retention`   | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `traces`      | `TraceApi`         | [trace](../trace/README.md)                   |

## Who depends on metric

[governance](../../enterprise/modules/governance/README.md) (as a peer).

<!-- readme:generated:end -->
