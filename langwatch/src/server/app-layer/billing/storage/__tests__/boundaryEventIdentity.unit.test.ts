import { describe, expect, it } from "vitest";

import { buildDedupKey } from "../boundaryEventIdentity";

const slice = {
  projectId: "project_1",
  category: "traces" as const,
  partitionKey: "202625",
  sliceDate: new Date(Date.UTC(2026, 5, 21)),
  retentionDays: 63,
};

describe("buildDedupKey()", () => {
  describe("when the same entry slice is recorded twice", () => {
    /** @scenario Recording the same entry slice twice stores one event */
    it("derives the same key both times", () => {
      expect(buildDedupKey({ ...slice, edge: "ENTRY" })).toEqual(
        buildDedupKey({ ...slice, edge: "ENTRY" }),
      );
    });
  });

  describe("when an exit mirrors its recorded entry (identical slice values)", () => {
    /** @scenario An exit event is never deduplicated against its matching entry */
    it("derives a different key for the exit", () => {
      expect(buildDedupKey({ ...slice, edge: "EXIT" })).not.toEqual(
        buildDedupKey({ ...slice, edge: "ENTRY" }),
      );
    });
  });

  describe("when a seed and a live entry cover the same slice", () => {
    /** @scenario Seed and entry events for the same slice collapse into one */
    it("derives the same key for both (shared edge-class)", () => {
      expect(buildDedupKey({ ...slice, edge: "SEED" })).toEqual(
        buildDedupKey({ ...slice, edge: "ENTRY" }),
      );
    });
  });

  describe("when two retention changes correct the same slice (63→91, then 91→63)", () => {
    /** @scenario Corrections from different causes are distinct events */
    it("keys each change's reversal by its own cause id", () => {
      expect(
        buildDedupKey({ ...slice, edge: "REVERSAL", causeId: "change_1" }),
      ).not.toEqual(
        buildDedupKey({ ...slice, edge: "REVERSAL", causeId: "change_2" }),
      );
    });

    it("keeps a cause-keyed re-emitted entry distinct from the original entry", () => {
      expect(
        buildDedupKey({ ...slice, edge: "ENTRY", causeId: "change_2" }),
      ).not.toEqual(buildDedupKey({ ...slice, edge: "ENTRY" }));
    });

    it("still dedups a replay of the same correction", () => {
      expect(
        buildDedupKey({ ...slice, edge: "REVERSAL", causeId: "change_1" }),
      ).toEqual(
        buildDedupKey({ ...slice, edge: "REVERSAL", causeId: "change_1" }),
      );
    });
  });

  describe("when a correction is emitted without its cause", () => {
    it("throws for REVERSAL", () => {
      expect(() => buildDedupKey({ ...slice, edge: "REVERSAL" })).toThrow(
        /causeId/,
      );
    });

    it("throws for DELETION", () => {
      expect(() => buildDedupKey({ ...slice, edge: "DELETION" })).toThrow(
        /causeId/,
      );
    });
  });
});
