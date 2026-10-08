/**
 * @vitest-environment node
 * A redelivered log record fact leaves one row: the row is keyed by log's record id.
 * Spec: modules/trace/specs/trace-log-record-storage.feature
 */
import { createTenantId } from "@langwatch/eventing";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "@langwatch/log-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryLogRecordStorageRepository } from "../../repositories/memory/memory.log-record-storage.repository.ts";
import { TraceLogRecordStorageMapProjection } from "../trace-log-record-storage.projection.ts";
import { TraceLogRecordStorageStore } from "../trace-log-record-storage.store.ts";
import { canonicalLogRecordFixture, logRecordsHarness } from "./trace-log-records.fixtures.ts";

describe("given log's record fact delivered to trace twice", () => {
  describe("when trace's log record lane maps both deliveries", () => {
    /** @scenario "A redelivered log record fact leaves one stored row" */
    it("holds one row for the record", async () => {
      const repository = MemoryLogRecordStorageRepository.create();
      const projection = TraceLogRecordStorageMapProjection.create({
        store: TraceLogRecordStorageStore.create({
          storage: repository,
          defaultRetentionDays: () => 30,
        }),
      });
      const data = canonicalLogRecordFixture();
      const event = {
        id: "event-1",
        aggregateId: data.recordId,
        aggregateType: "log",
        tenantId: createTenantId(data.tenantId),
        type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
        version: CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
        createdAt: data.acceptedAt,
        occurredAt: data.occurredAt,
        data,
      };
      const context = { aggregateId: data.recordId, tenantId: createTenantId(data.tenantId) };

      for (let delivery = 0; delivery < 2; delivery++) {
        const row = projection.mapLogRecordReceived(event);
        if (row) await projection.store.append(row, context);
      }

      expect(repository.storedRows()).toHaveLength(1);
    });

    it("holds one row when log records the same record under two event ids", async () => {
      const { eventing, record, repository } = logRecordsHarness();

      await record(canonicalLogRecordFixture(), "event-first");
      await record(canonicalLogRecordFixture(), "event-retried");

      await vi.waitFor(async () => {
        const rows = await repository.findLogsByTraceId({
          tenantId: "project-1",
          traceId: "trace-1",
        });
        expect(rows).toHaveLength(1);
      });
      expect(repository.storedRows()).toHaveLength(1);
      await eventing.close();
    });
  });
});
