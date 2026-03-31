import { describe, expect, it } from "vitest";
import { createTenantId, type Command } from "../../../../";
import type { BulkSyncAnnotationsCommandData } from "../../schemas/commands";
import {
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
  BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
} from "../../schemas/constants";
import { BulkSyncAnnotationsCommand } from "../bulkSyncAnnotationsCommand";

function createCommand({
  tenantId = "tenant-1",
  traceId = "trace-1",
  annotationIds = ["ann-1", "ann-2"],
  occurredAt = 1000000,
}: Partial<BulkSyncAnnotationsCommandData> = {}): Command<BulkSyncAnnotationsCommandData> {
  return {
    type: BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
    aggregateId: traceId,
    tenantId: createTenantId(tenantId),
    data: { tenantId, traceId, annotationIds, occurredAt },
  };
}

describe("BulkSyncAnnotationsCommand", () => {
  describe("handle()", () => {
    it("emits a single AnnotationsBulkSyncedEvent", () => {
      const handler = new BulkSyncAnnotationsCommand();
      const events = handler.handle(createCommand());

      expect(events).toHaveLength(1);
    });

    it("emits event with correct type", () => {
      const handler = new BulkSyncAnnotationsCommand();
      const [event] = handler.handle(createCommand());

      expect(event!.type).toBe(ANNOTATIONS_BULK_SYNCED_EVENT_TYPE);
    });

    it("emits event with correct version", () => {
      const handler = new BulkSyncAnnotationsCommand();
      const [event] = handler.handle(createCommand());

      expect(event!.version).toBe(ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST);
    });

    it("emits event with all annotation IDs in data", () => {
      const handler = new BulkSyncAnnotationsCommand();
      const [event] = handler.handle(
        createCommand({ annotationIds: ["a1", "a2", "a3"] }),
      );

      expect(event!.data.annotationIds).toEqual(["a1", "a2", "a3"]);
    });

    it("emits event with correct aggregate ID", () => {
      const handler = new BulkSyncAnnotationsCommand();
      const [event] = handler.handle(
        createCommand({ traceId: "my-trace" }),
      );

      expect(event!.aggregateId).toBe("my-trace");
    });
  });

  describe("getAggregateId()", () => {
    it("returns the trace ID", () => {
      const payload: BulkSyncAnnotationsCommandData = {
        tenantId: "t1",
        traceId: "tr1",
        annotationIds: ["a1"],
        occurredAt: 1000,
      };

      expect(BulkSyncAnnotationsCommand.getAggregateId(payload)).toBe("tr1");
    });
  });

  describe("makeJobId()", () => {
    it("includes tenant and trace ID", () => {
      const payload: BulkSyncAnnotationsCommandData = {
        tenantId: "t1",
        traceId: "tr1",
        annotationIds: ["a1"],
        occurredAt: 1000,
      };

      expect(BulkSyncAnnotationsCommand.makeJobId(payload)).toBe(
        "t1:tr1:bulk_sync_annotations",
      );
    });
  });
});
