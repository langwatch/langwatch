import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_VERSION_LATEST,
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
} from "../../schemas/constants";
import type {
  AnnotationAddedEvent,
  AnnotationRemovedEvent,
  AnnotationsBulkSyncedEvent,
} from "../../schemas/events";
import { TraceSummaryFoldProjection } from "../traceSummary.foldProjection";

function createFoldProjection() {
  const store = {
    store: async () => {},
    get: async () => null,
  };
  return new TraceSummaryFoldProjection({ store });
}

function makeInitState(): TraceSummaryData {
  return createFoldProjection().init();
}

function makeAnnotationAddedEvent({
  annotationId,
}: {
  annotationId: string;
}): AnnotationAddedEvent {
  return {
    id: `evt-${annotationId}`,
    type: ANNOTATION_ADDED_EVENT_TYPE,
    version: ANNOTATION_ADDED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "trace-1",
    tenantId: createTenantId("tenant-1"),
    createdAt: Date.now(),
    occurredAt: Date.now(),
    data: { traceId: "trace-1", annotationId },
    metadata: {},
  };
}

function makeAnnotationRemovedEvent({
  annotationId,
}: {
  annotationId: string;
}): AnnotationRemovedEvent {
  return {
    id: `evt-remove-${annotationId}`,
    type: ANNOTATION_REMOVED_EVENT_TYPE,
    version: ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "trace-1",
    tenantId: createTenantId("tenant-1"),
    createdAt: Date.now(),
    occurredAt: Date.now(),
    data: { traceId: "trace-1", annotationId },
    metadata: {},
  };
}

function makeAnnotationsBulkSyncedEvent({
  annotationIds,
}: {
  annotationIds: string[];
}): AnnotationsBulkSyncedEvent {
  return {
    id: "evt-bulk-sync",
    type: ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
    version: ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "trace-1",
    tenantId: createTenantId("tenant-1"),
    createdAt: Date.now(),
    occurredAt: Date.now(),
    data: { traceId: "trace-1", annotationIds },
    metadata: {},
  };
}

describe("traceSummary fold projection — annotation events", () => {
  const projection = createFoldProjection();

  describe("init()", () => {
    it("initializes annotationIds as empty array", () => {
      const state = projection.init();
      expect(state.annotationIds).toEqual([]);
    });
  });

  describe("apply()", () => {
    describe("when AnnotationAddedEvent is received", () => {
      it("appends the annotation ID to the array", () => {
        const state = makeInitState();
        const event = makeAnnotationAddedEvent({ annotationId: "ann-1" });

        const result = projection.apply(state, event);

        expect(result.annotationIds).toEqual(["ann-1"]);
      });

      it("updates updatedAt timestamp", () => {
        const state = makeInitState();
        const event = makeAnnotationAddedEvent({ annotationId: "ann-1" });

        const result = projection.apply(state, event);

        expect(result.updatedAt).toBeGreaterThanOrEqual(state.updatedAt);
      });

      describe("when the same annotation ID is added twice", () => {
        it("does not duplicate the ID (idempotent)", () => {
          const state = makeInitState();
          const event = makeAnnotationAddedEvent({ annotationId: "ann-1" });

          const afterFirst = projection.apply(state, event);
          const afterSecond = projection.apply(afterFirst, event);

          expect(afterSecond.annotationIds).toEqual(["ann-1"]);
        });
      });
    });

    describe("when AnnotationRemovedEvent is received", () => {
      it("removes the annotation ID from the array", () => {
        let state = makeInitState();
        state = projection.apply(
          state,
          makeAnnotationAddedEvent({ annotationId: "ann-1" }),
        );
        state = projection.apply(
          state,
          makeAnnotationAddedEvent({ annotationId: "ann-2" }),
        );

        const result = projection.apply(
          state,
          makeAnnotationRemovedEvent({ annotationId: "ann-1" }),
        );

        expect(result.annotationIds).toEqual(["ann-2"]);
      });

      it("returns the same state when removing a non-existent ID", () => {
        const state = makeInitState();

        const result = projection.apply(
          state,
          makeAnnotationRemovedEvent({ annotationId: "non-existent" }),
        );

        expect(result.annotationIds).toEqual([]);
      });
    });

    describe("when AnnotationsBulkSyncedEvent is received", () => {
      it("merges with existing annotation IDs without duplicates", () => {
        let state = makeInitState();
        state = projection.apply(
          state,
          makeAnnotationAddedEvent({ annotationId: "old-ann" }),
        );

        const result = projection.apply(
          state,
          makeAnnotationsBulkSyncedEvent({
            annotationIds: ["old-ann", "bulk-1", "bulk-2"],
          }),
        );

        expect(result.annotationIds).toEqual(["old-ann", "bulk-1", "bulk-2"]);
      });
    });

    describe("when add then remove occurs", () => {
      it("results in empty array", () => {
        let state = makeInitState();
        state = projection.apply(
          state,
          makeAnnotationAddedEvent({ annotationId: "ann-1" }),
        );
        state = projection.apply(
          state,
          makeAnnotationRemovedEvent({ annotationId: "ann-1" }),
        );

        expect(state.annotationIds).toEqual([]);
      });
    });

    describe("when bulk sync then add occurs", () => {
      it("combines the results", () => {
        let state = makeInitState();
        state = projection.apply(
          state,
          makeAnnotationsBulkSyncedEvent({
            annotationIds: ["bulk-1", "bulk-2"],
          }),
        );
        state = projection.apply(
          state,
          makeAnnotationAddedEvent({ annotationId: "new-ann" }),
        );

        expect(state.annotationIds).toEqual(["bulk-1", "bulk-2", "new-ann"]);
      });
    });
  });

  describe("version", () => {
    it("uses the latest projection version", () => {
      expect(projection.version).toBe(TRACE_SUMMARY_PROJECTION_VERSION_LATEST);
    });
  });
});
