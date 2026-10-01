import { createTenantId } from "@langwatch/eventing";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { describe, expect, it, vi } from "vitest";

import { CanonicalLogRecordStore } from "../../eventing/canonical-log-record.store.ts";
import type { CanonicalLogRecordRepository } from "../canonical-log-record.repository.ts";

describe("CanonicalLogRecordStore", () => {
  it("delegates a projection batch as one repository operation", async () => {
    const ensureLogRecord = vi.fn(async () => undefined);
    const ensureLogRecords = vi.fn(async () => undefined);
    const getLogsByTraceId = vi.fn(async () => []);
    const repository = {
      ensureLogRecord,
      ensureLogRecords,
      findLogsByTraceId: getLogsByTraceId,
    } satisfies CanonicalLogRecordRepository;
    const records = [
      { recordId: "a".repeat(64) },
      { recordId: "b".repeat(64) },
    ] as CanonicalLogRecord[];

    await CanonicalLogRecordStore.create(repository, 49).bulkAppend(records, {
      tenantId: createTenantId("project_test"),
      retentionPolicy: null,
    });

    expect(ensureLogRecords).toHaveBeenCalledOnce();
    expect(ensureLogRecords).toHaveBeenCalledWith(records, 49);
    expect(ensureLogRecord).not.toHaveBeenCalled();
  });
});
