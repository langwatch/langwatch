import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecordRepository } from "~/server/app-layer/logs/repositories/canonical-log-record.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { CanonicalLogAppendStore } from "../projections/stores";
import type { CanonicalLogRecord } from "../schemas/logRecord";

describe("CanonicalLogAppendStore", () => {
  it("delegates a projection batch as one repository operation", async () => {
    const ensureLogRecord = vi.fn(async () => undefined);
    const ensureLogRecords = vi.fn(async () => undefined);
    const repository = {
      ensureLogRecord,
      ensureLogRecords,
      getLogsByTraceId: async () => [],
    } satisfies CanonicalLogRecordRepository;
    const records = [
      { recordId: "a".repeat(64) },
      { recordId: "b".repeat(64) },
    ] as CanonicalLogRecord[];

    await new CanonicalLogAppendStore(repository).bulkAppend(records, {
      tenantId: createTenantId("project_test"),
      retentionPolicy: null,
    });

    expect(ensureLogRecords).toHaveBeenCalledOnce();
    expect(ensureLogRecords).toHaveBeenCalledWith(
      records,
      PLATFORM_DEFAULT_RETENTION_DAYS,
    );
    expect(ensureLogRecord).not.toHaveBeenCalled();
  });
});
