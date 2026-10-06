# log

Logs: receiving OTLP logs, canonicalising and recording them, and reading a trace's logs.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                      |
| -------------- | ------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                      |
| Subjects       | log, log-ingestion                                                                   |
| Halves         | [contract](contract) · [process](process/README.md)                                  |
| Api token      | `LogApi` = `moduleApi<LogApi>()("log")`, `contract/src/log.api.ts:63` (5 operations) |
| Installed by   | api, worker, tasks (process)                                                         |

## What log owns

| Kind                      | Name                                       | Declared at                                                                                    |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `log_records`                              | `process/src/repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts:254` |
| ClickHouse table (writes) | `log_usage_estimates`                      | `process/src/repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts:260` |
| Stores required           | clickhouse                                 | `process/src/repositories/live/live.log.repositories.ts:10`                                    |
| Config                    | `processingShards` (LOG_PROCESSING_SHARDS) | `contract/src/log.api.ts:70`                                                                   |

Anything else log needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token              | Module                                        |
| ------------- | ------------------ | --------------------------------------------- |
| `dataPrivacy` | `DataPrivacyApi`   | [data-privacy](../data-privacy/README.md)     |
| `retention`   | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `traces`      | `TraceApi`         | [trace](../trace/README.md)                   |

## Who depends on log

[governance](../../enterprise/modules/governance/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->
