import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecordAppendPort } from "../../src/ports/telemetry-repositories.port";

import { CanonicalLogAppendStore } from "../../src/stores/log-record/log-record.store";
import type { CanonicalLogRecord } from "@langwatch/telemetry-contract";

describe("CanonicalLogAppendStore", () => {
  it("delegates a projection batch as one repository operation", async () => {
    const ensureLogRecord = vi.fn(async () => undefined);
    const ensureLogRecords = vi.fn(async () => undefined);
    const repository = {
      ensureLogRecord,
      ensureLogRecords,
    } satisfies CanonicalLogRecordAppendPort;
    const records = [
      { recordId: "a".repeat(64) },
      { recordId: "b".repeat(64) },
    ] as CanonicalLogRecord[];

    await new CanonicalLogAppendStore(repository, 49).bulkAppend(records, {
      tenantId: createTenantId("project_test"),
      retentionPolicy: null,
    });

    expect(ensureLogRecords).toHaveBeenCalledOnce();
    expect(ensureLogRecords).toHaveBeenCalledWith(records, 49);
    expect(ensureLogRecord).not.toHaveBeenCalled();
  });
});
