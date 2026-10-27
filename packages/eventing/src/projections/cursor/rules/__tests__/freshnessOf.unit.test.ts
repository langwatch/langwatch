/**
 * @vitest-environment node
 * Spec: packages/eventing/specs/projection-cursor-reads.feature
 */
import { Instance, Ksuid } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import { freshnessOf } from "../freshnessOf.ts";

function eventId({
  second,
  writer,
  sequenceId = 0,
}: {
  second: number;
  writer: number;
  sequenceId?: number;
}): string {
  const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8).fill(writer));
  return new Ksuid({
    environment: "prod",
    resource: "event",
    timestamp: second,
    instance,
    sequenceId,
  }).toString();
}

const NOW = 1_800_000_000;

/** The aggregate verdict: these rules compare the hint's own aggregate cursor. */
const caughtUp = (ids: { answerId: string; hintId: string }) =>
  freshnessOf({ ...ids, scope: "aggregate" }) === "fresh";

describe("freshnessOf", () => {
  describe("when the answer is in a later second than the hint", () => {
    /** @scenario "An answer a second or more past the hint is fresh" */
    it("is fresh whichever instance wrote either event", () => {
      const hintId = eventId({ second: NOW, writer: 9 });
      expect(caughtUp({ answerId: eventId({ second: NOW + 1, writer: 1 }), hintId })).toBe(true);
    });

    /** @scenario "An answer in a later second is fresh even when its id sorts below the hint's" */
    it("is fresh when the ids' string order disagrees with their time", () => {
      const wrap = NOW - (NOW % 65536) + 65536;
      const hintId = eventId({ second: wrap - 1, writer: 1 });
      const answerId = eventId({ second: wrap, writer: 1 });
      expect(answerId < hintId).toBe(true);
      expect(caughtUp({ answerId, hintId })).toBe(true);
    });
  });

  describe("when the answer is in an earlier second than the hint", () => {
    /** @scenario "An answer from an earlier second than the hint is not fresh" */
    it("is not fresh", () => {
      const hintId = eventId({ second: NOW, writer: 1 });
      expect(caughtUp({ answerId: eventId({ second: NOW - 1, writer: 9 }), hintId })).toBe(false);
    });
  });

  describe("when the answer is the hint's own event", () => {
    /** @scenario "An answer carrying the hint's own event id is fresh" */
    it("is fresh", () => {
      const id = eventId({ second: NOW, writer: 1 });
      expect(caughtUp({ answerId: id, hintId: id })).toBe(true);
    });
  });

  describe("when another instance's event shares the hint's second", () => {
    /** @scenario "An answer from another instance inside the hint's second is not fresh" */
    it("is not fresh when its id sorts above the hint's", () => {
      const hintId = eventId({ second: NOW, writer: 1 });
      const answerId = eventId({ second: NOW, writer: 2 });
      expect(answerId > hintId).toBe(true);
      expect(caughtUp({ answerId, hintId })).toBe(false);
    });

    it("is not fresh when its id sorts below the hint's", () => {
      const hintId = eventId({ second: NOW, writer: 2 });
      const answerId = eventId({ second: NOW, writer: 1 });
      expect(answerId < hintId).toBe(true);
      expect(caughtUp({ answerId, hintId })).toBe(false);
    });
  });

  describe("when the same instance wrote a later event in the hint's second", () => {
    /** @scenario "An answer from another instance inside the hint's second is not fresh" */
    it("is not fresh, because only equality proves the hint's event is in", () => {
      const hintId = eventId({ second: NOW, writer: 1, sequenceId: 1 });
      const answerId = eventId({ second: NOW, writer: 1, sequenceId: 2 });
      expect(caughtUp({ answerId, hintId })).toBe(false);
    });
  });

  describe("when an id is not a KSUID", () => {
    /** @scenario "An id that is not a KSUID is never fresh" */
    it("is not fresh as the answer", () => {
      expect(caughtUp({ answerId: "not-an-id", hintId: eventId({ second: NOW, writer: 1 }) })).toBe(
        false,
      );
    });

    it("is not fresh as the hint", () => {
      expect(caughtUp({ answerId: eventId({ second: NOW, writer: 1 }), hintId: "" })).toBe(false);
    });
  });

  describe("when the answer carries the tenant cursor", () => {
    /** @scenario "A tenant-wide answer past the hint is only approximately fresh" */
    it("is approximate, never fresh, even for the hint's own id", () => {
      const hintId = eventId({ second: NOW, writer: 1 });
      const later = eventId({ second: NOW + 1, writer: 2 });
      expect(freshnessOf({ answerId: later, hintId, scope: "tenant" })).toBe("approximate");
      expect(freshnessOf({ answerId: hintId, hintId, scope: "tenant" })).toBe("approximate");
    });

    it("is stale when the tenant cursor has not passed the hint", () => {
      const hintId = eventId({ second: NOW, writer: 1 });
      const earlier = eventId({ second: NOW - 1, writer: 2 });
      expect(freshnessOf({ answerId: earlier, hintId, scope: "tenant" })).toBe("stale");
    });
  });

  describe("when run A's event is delayed behind run B's later one", () => {
    /** @scenario "A slow run's event is never reported caught up by another run's later event" */
    it("never reports A caught up until A's own cursor holds its event", () => {
      const aBefore = eventId({ second: NOW - 5, writer: 1 });
      const aDelayed = eventId({ second: NOW, writer: 1 });
      const bCommitted = eventId({ second: NOW + 1, writer: 2 });
      const tenantCursor = bCommitted;

      const list = freshnessOf({ answerId: tenantCursor, hintId: aDelayed, scope: "tenant" });
      const runA = freshnessOf({ answerId: aBefore, hintId: aDelayed, scope: "aggregate" });
      expect(list).not.toBe("fresh");
      expect(runA).toBe("stale");

      const runAApplied = freshnessOf({ answerId: aDelayed, hintId: aDelayed, scope: "aggregate" });
      expect(runAApplied).toBe("fresh");
    });
  });
});
