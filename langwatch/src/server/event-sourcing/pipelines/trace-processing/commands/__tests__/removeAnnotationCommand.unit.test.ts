import { describe, expect, it } from "vitest";
import { createTenantId, type Command } from "../../../../";
import type { RemoveAnnotationCommandData } from "../../schemas/commands";
import {
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
  REMOVE_ANNOTATION_COMMAND_TYPE,
} from "../../schemas/constants";
import { RemoveAnnotationCommand } from "../removeAnnotationCommand";

function createCommand({
  tenantId = "tenant-1",
  traceId = "trace-1",
  annotationId = "ann-1",
  occurredAt = 1000000,
}: Partial<RemoveAnnotationCommandData> = {}): Command<RemoveAnnotationCommandData> {
  return {
    type: REMOVE_ANNOTATION_COMMAND_TYPE,
    aggregateId: traceId,
    tenantId: createTenantId(tenantId),
    data: { tenantId, traceId, annotationId, occurredAt },
  };
}

describe("RemoveAnnotationCommand", () => {
  describe("handle()", () => {
    it("emits a single AnnotationRemovedEvent", () => {
      const handler = new RemoveAnnotationCommand();
      const events = handler.handle(createCommand());

      expect(events).toHaveLength(1);
    });

    it("emits event with correct type", () => {
      const handler = new RemoveAnnotationCommand();
      const [event] = handler.handle(createCommand());

      expect(event!.type).toBe(ANNOTATION_REMOVED_EVENT_TYPE);
    });

    it("emits event with correct version", () => {
      const handler = new RemoveAnnotationCommand();
      const [event] = handler.handle(createCommand());

      expect(event!.version).toBe(ANNOTATION_REMOVED_EVENT_VERSION_LATEST);
    });

    it("emits event with the annotation ID in data", () => {
      const handler = new RemoveAnnotationCommand();
      const [event] = handler.handle(
        createCommand({ annotationId: "my-annotation" }),
      );

      expect(event!.data.annotationId).toBe("my-annotation");
    });

    it("emits event with correct aggregate ID", () => {
      const handler = new RemoveAnnotationCommand();
      const [event] = handler.handle(
        createCommand({ traceId: "my-trace" }),
      );

      expect(event!.aggregateId).toBe("my-trace");
    });
  });

  describe("getAggregateId()", () => {
    it("returns the trace ID", () => {
      const payload: RemoveAnnotationCommandData = {
        tenantId: "t1",
        traceId: "tr1",
        annotationId: "a1",
        occurredAt: 1000,
      };

      expect(RemoveAnnotationCommand.getAggregateId(payload)).toBe("tr1");
    });
  });

  describe("makeJobId()", () => {
    it("includes tenant, trace, and annotation ID", () => {
      const payload: RemoveAnnotationCommandData = {
        tenantId: "t1",
        traceId: "tr1",
        annotationId: "a1",
        occurredAt: 1000,
      };

      expect(RemoveAnnotationCommand.makeJobId(payload)).toBe(
        "t1:tr1:remove_annotation:a1",
      );
    });
  });
});
