import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { LOG_DEFAULT_RETENTION_DAYS } from "@langwatch/log-contract";

import { ClickHouseCanonicalLogRecordAppendRepository } from "../clickhouse/clickhouse.canonical-log-record-append.repository.ts";
import type { LogRepositories } from "../log.repositories.ts";

/** The live tier: canonical log records in the process's one routed ClickHouse client. */
export class LiveLogRepositories {
  static readonly requires = ["clickhouse"] as const;

  static create({ clickhouse }: Readonly<{ clickhouse: ClickHouseQueryClient }>): LogRepositories {
    return {
      logRecords: ClickHouseCanonicalLogRecordAppendRepository.create({
        resolveClient: ClickHouseCanonicalLogRecordAppendRepository.resolverOver(clickhouse),
        defaultRetentionDays: LOG_DEFAULT_RETENTION_DAYS,
      }),
    };
  }
}
