# log

Logs: receiving OTLP logs, canonicalising and recording them, and reading a trace's logs.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                      |
| -------------- | ------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                      |
| Subjects       | log, log-ingestion                                                                   |
| Halves         | [contract](contract) · [process](process/README.md)                                  |
| Api token      | `LogApi` = `moduleApi<LogApi>()("log")`, `contract/src/log.api.ts:51` (4 operations) |
| Installed by   | api, worker, tasks (process)                                                         |

## What log owns

| Kind                      | Name                                       | Declared at                                                                                    |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `log_records`                              | `process/src/repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts:251` |
| ClickHouse table (writes) | `log_usage_estimates`                      | `process/src/repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts:257` |
| Stores required           | clickhouse                                 | `process/src/repositories/live/live.log.repositories.ts:9`                                     |
| Config                    | `processingShards` (LOG_PROCESSING_SHARDS) | `contract/src/log.config.ts:9`                                                                 |

Anything else log needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token              | Module                                        |
| ------------- | ------------------ | --------------------------------------------- |
| `dataPrivacy` | `DataPrivacyApi`   | [data-privacy](../data-privacy/README.md)     |
| `retention`   | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `traces`      | `TraceApi`         | [trace](../trace/README.md)                   |

## Who depends on log

[governance](../../enterprise/modules/governance/README.md) (as a peer).

<!-- readme:generated:end -->
