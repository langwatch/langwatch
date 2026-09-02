/**
 * The addresses an annotation row opens, as query writes.
 *
 * These used to be `openDrawer(...)` calls the platform pages made through the
 * application's registry. They are the family's own now, and the assertions
 * that follow are what says a moved row still means what it meant — because
 * the chrome that mounts the two application drawers is not above these screens
 * yet, so nothing about the rendered result can tell you the address was right.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { describe, expect, it } from "vitest";
import {
  addDatasetRecordAddress,
  closedQueueEditorAddress,
  QUEUE_EDITOR_PARAM,
  queueEditorAddress,
  queueItemHref,
  readQueueEditor,
  traceDetailsAddress,
} from "../annotation-overlay-address";

describe("given a row that opens the trace explorer's drawer", () => {
  describe("when the row knows when its trace started", () => {
    it("names the drawer, the trace and the partition hint", () => {
      expect(
        traceDetailsAddress({
          current: {},
          traceId: "trace-1",
          occurredAtMs: 1754049600000,
        }),
      ).toEqual({
        "drawer.open": "traceV2Details",
        "drawer.traceId": "trace-1",
        "drawer.t": "1754049600000",
      });
    });
  });

  describe("when the row carries no timestamp", () => {
    it("leaves the hint off rather than guessing one", () => {
      const address = traceDetailsAddress({ current: {}, traceId: "trace-1" });

      expect(address["drawer.traceId"]).toBe("trace-1");
      expect(address).not.toHaveProperty("drawer.t");
    });
  });

  describe("when another drawer is already on the address", () => {
    it("clears every drawer parameter and keeps the page's own", () => {
      const address = traceDetailsAddress({
        current: {
          pageOffset: "25",
          period: "30d",
          "drawer.open": "addDatasetRecord",
          "drawer.selectedTraceIds": "trace-9",
        },
        traceId: "trace-1",
      });

      expect(address.pageOffset).toBe("25");
      expect(address.period).toBe("30d");
      expect(address["drawer.open"]).toBe("traceV2Details");
      // Left over from the previous drawer, it would reach the new one.
      expect(address["drawer.selectedTraceIds"]).toBeUndefined();
    });
  });
});

describe("given rows handed to a dataset", () => {
  describe("when several traces are picked", () => {
    it("names the dataset drawer and every trace, since the address is single-valued", () => {
      expect(addDatasetRecordAddress({ current: {}, traceIds: ["trace-1", "trace-3"] })).toEqual({
        "drawer.open": "addDatasetRecord",
        "drawer.selectedTraceIds": "trace-1,trace-3",
      });
    });
  });
});

describe("given the queue editor, which is this family's own overlay", () => {
  describe("when it is opened on an existing queue", () => {
    it("names the queue and leaves the rest of the address alone", () => {
      const address = queueEditorAddress({
        current: { pageOffset: "25" },
        queueId: "q1",
      });

      expect(address[QUEUE_EDITOR_PARAM]).toBe("q1");
      expect(address.pageOffset).toBe("25");
      expect(readQueueEditor(address)).toEqual({ queueId: "q1" });
    });
  });

  describe("when it is opened to create one", () => {
    it("says so with a value that is not an id", () => {
      const address = queueEditorAddress({ current: {} });

      expect(address[QUEUE_EDITOR_PARAM]).toBe("new");
      expect(readQueueEditor(address)).toEqual({ queueId: undefined });
    });
  });

  describe("when it is closed", () => {
    it("reads as closed and takes only its own key off", () => {
      const address = closedQueueEditorAddress({
        [QUEUE_EDITOR_PARAM]: "q1",
        period: "7d",
      });

      expect(readQueueEditor(address)).toBeNull();
      expect(address.period).toBe("7d");
    });
  });

  describe("when the address carries nothing about it", () => {
    it("reads as closed", () => {
      expect(readQueueEditor({})).toBeNull();
      expect(readQueueEditor({ [QUEUE_EDITOR_PARAM]: "" })).toBeNull();
    });
  });
});

describe("given a queue item that is still waiting", () => {
  describe("when the reviewer opens it", () => {
    /**
     * The walker is still served by `platform/app`, so this is a plain address
     * across the seam rather than anything this package renders. The shape is
     * the one `AnnotationsTable` wrote, unchanged, because a link minted before
     * the move has to keep working.
     */
    it("goes to the queue walker naming the item and its trace", () => {
      expect(
        queueItemHref({
          projectSlug: "acme",
          queueItemId: "item-1",
          traceId: "trace-1",
        }),
      ).toBe("/acme/annotations/my-queue?queue-item=item-1&trace=trace-1");
    });
  });
});
