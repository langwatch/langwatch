/**
 * @vitest-environment node
 * Trace media names the owner's retention to Stored Objects, which links it that long.
 * @see specs/trace-processing/trace-media-blob-extraction.feature
 */
import type { StoreStoredObjectFromBytesInput } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import {
  SCENARIO_EVENT_MEDIA,
  TRACE_CONTENT_MEDIA,
  TraceMediaStoreService,
} from "../trace-media-store.service.ts";

function recordingStoredObjects() {
  const stores: StoreStoredObjectFromBytesInput[] = [];
  return {
    stores,
    storedObjects: {
      storeFromBytes: async (input: StoreStoredObjectFromBytesInput) => {
        stores.push(input);
        return { reference: { id: "so_1" }, isDuplicate: false };
      },
    } as never,
  };
}

const bytes = Buffer.from("media");

describe("TraceMediaStoreService", () => {
  describe("when trace media is stored for a project that keeps traces for 30 days", () => {
    /** @scenario Trace media names the project's trace retention when it is stored */
    it("names a 30-day retention", async () => {
      const { stores, storedObjects } = recordingStoredObjects();
      const store = TraceMediaStoreService.create({
        storedObjects,
        purpose: TRACE_CONTENT_MEDIA,
        retention: {
          getRetentionDays: async ({ category }) => (category === "traces" ? 30 : 1),
        },
      });

      await store.storeFromBytes({ projectId: "p1", ownerId: "t1", mediaType: "image/png", bytes });

      expect(stores).toEqual([expect.objectContaining({ ownerId: "t1", retentionDays: 30 })]);
    });
  });

  describe("when scenario event media is stored", () => {
    /** @scenario Trace media names the project's trace retention when it is stored */
    it("names no retention and asks for none", async () => {
      const { stores, storedObjects } = recordingStoredObjects();
      const store = TraceMediaStoreService.create({ storedObjects, purpose: SCENARIO_EVENT_MEDIA });

      await store.storeFromBytes({ projectId: "p1", ownerId: "r1", mediaType: "image/png", bytes });

      expect(stores[0]).not.toHaveProperty("retentionDays");
    });
  });
});
