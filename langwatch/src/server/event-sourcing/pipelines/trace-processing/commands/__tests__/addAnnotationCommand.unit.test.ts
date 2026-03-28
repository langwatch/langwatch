import { describe, expect, it } from "vitest";
import { createTenantId, type Command } from "../../../../";
import type { AddAnnotationCommandData } from "../../schemas/commands";
import {
  ADD_ANNOTATION_COMMAND_TYPE,
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import { AddAnnotationCommand } from "../addAnnotationCommand";

function createCommand({
  tenantId = "tenant-1",
  traceId = "trace-1",
  annotationId = "ann-1",
  occurredAt = 1000000,
}: Partial<AddAnnotationCommandData> = {}): Command<AddAnnotationCommandData> {
  return {
    type: ADD_ANNOTATION_COMMAND_TYPE,
    aggregateId: traceId,
    tenantId: createTenantId(tenantId),
    data: { tenantId, traceId, annotationId, occurredAt },
  };
}

describe("AddAnnotationCommand", () => {
  describe("handle()", () => {
    it("emits a single AnnotationAddedEvent", () => {
      const handler = new AddAnnotationCommand();
      const events = handler.handle(createCommand());

      expect(events).toHaveLength(1);
    });

    it("emits event with correct type", () => {
      const handler = new AddAnnotationCommand();
      const [event] = handler.handle(createCommand());

      expect(event!.type).toBe(ANNOTATION_ADDED_EVENT_TYPE);
    });

    it("emits event with correct version", () => {
      const handler = new AddAnnotationCommand();
      const [event] = handler.handle(createCommand());

      expect(event!.version).toBe(ANNOTATION_ADDED_EVENT_VERSION_LATEST);
    });

    it("emits event with the annotation ID in data", () => {
      const handler = new AddAnnotationCommand();
      const [event] = handler.handle(
        createCommand({ annotationId: "my-annotation" }),
      );

      expect(event!.data.annotationId).toBe("my-annotation");
    });

    it("emits event with correct aggregate ID", () => {
      const handler = new AddAnnotationCommand();
      const [event] = handler.handle(
        createCommand({ traceId: "my-trace" }),
      );

      expect(event!.aggregateId).toBe("my-trace");
    });
  });

  describe("getAggregateId()", () => {
    it("returns the trace ID", () => {
      const payload: AddAnnotationCommandData = {
        tenantId: "t1",
        traceId: "tr1",
        annotationId: "a1",
        occurredAt: 1000,
      };

      expect(AddAnnotationCommand.getAggregateId(payload)).toBe("tr1");
    });
  });

  describe("makeJobId()", () => {
    it("includes tenant, trace, and annotation ID", () => {
      const payload: AddAnnotationCommandData = {
        tenantId: "t1",
        traceId: "tr1",
        annotationId: "a1",
        occurredAt: 1000,
      };

      expect(AddAnnotationCommand.makeJobId(payload)).toBe(
        "t1:tr1:add_annotation:a1",
      );
    });
  });
});
