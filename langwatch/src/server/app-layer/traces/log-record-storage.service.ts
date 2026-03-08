import type { ClickHouseClient } from "@clickhouse/client";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { createLogger } from "~/utils/logger/server";
import { traced } from "../tracing";
import { LogRecordStorageClickHouseRepository } from "./repositories/log-record-storage.clickhouse.repository";
import {
  NullLogRecordStorageRepository,
  type LogRecordStorageRepository,
} from "./repositories/log-record-storage.repository";

const logger = createLogger("langwatch:log-record-storage");

export class LogRecordStorageService {
  constructor(readonly repository: LogRecordStorageRepository) {}

  static create(clickhouse: ClickHouseClient | null): LogRecordStorageService {
    if (!clickhouse) {
      logger.warn("ClickHouse not configured — using NullLogRecordStorageRepository (noop)");
    }
    const repo = clickhouse
      ? new LogRecordStorageClickHouseRepository(clickhouse)
      : new NullLogRecordStorageRepository();
    return traced(new LogRecordStorageService(repo), "LogRecordStorageService");
  }

  async insertLogRecord(record: NormalizedLogRecord): Promise<void> {
    await this.repository.insertLogRecord(record);
  }
}
