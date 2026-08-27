import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecordRepository } from "../src/repositories/canonical-log-record.repository";

import { CanonicalLogRecordStore } from "../src/stores/eventing/eventing.canonical-log-record.store";
import type { CanonicalLogRecord } from "@langwatch/log-contract";

describe("CanonicalLogRecordStore", () => {
  it("delegates a projection batch as one repository operation", async () => {
    const ensureLogRecord = vi.fn(async () => undefined);
    const ensureLogRecords = vi.fn(async () => undefined);
    const getLogsByTraceId = vi.fn(async () => []);
    const repository = {
      ensureLogRecord,
      ensureLogRecords,
      getLogsByTraceId,
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
