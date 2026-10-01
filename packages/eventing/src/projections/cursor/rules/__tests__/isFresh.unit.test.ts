/**
 * @vitest-environment node
 * Spec: packages/eventing/specs/projection-cursor-reads.feature
 */
import { Instance, Ksuid } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import { isFresh } from "../isFresh.ts";

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

describe("isFresh", () => {
  describe("when the answer is in a later second than the hint", () => {
    /** @scenario "An answer a second or more past the hint is fresh" */
    it("is fresh whichever instance wrote either event", () => {
      const hintId = eventId({ second: NOW, writer: 9 });
      expect(isFresh({ answerId: eventId({ second: NOW + 1, writer: 1 }), hintId })).toBe(true);
    });

    /** @scenario "An answer in a later second is fresh even when its id sorts below the hint's" */
    it("is fresh when the ids' string order disagrees with their time", () => {
      const wrap = NOW - (NOW % 65536) + 65536;
      const hintId = eventId({ second: wrap - 1, writer: 1 });
      const answerId = eventId({ second: wrap, writer: 1 });
      expect(answerId < hintId).toBe(true);
      expect(isFresh({ answerId, hintId })).toBe(true);
    });
  });

  describe("when the answer is in an earlier second than the hint", () => {
    /** @scenario "An answer from an earlier second than the hint is not fresh" */
    it("is not fresh", () => {
      const hintId = eventId({ second: NOW, writer: 1 });
      expect(isFresh({ answerId: eventId({ second: NOW - 1, writer: 9 }), hintId })).toBe(false);
    });
  });

  describe("when the answer is the hint's own event", () => {
    /** @scenario "An answer carrying the hint's own event id is fresh" */
    it("is fresh", () => {
      const id = eventId({ second: NOW, writer: 1 });
      expect(isFresh({ answerId: id, hintId: id })).toBe(true);
    });
  });

  describe("when another instance's event shares the hint's second", () => {
    /** @scenario "An answer from another instance inside the hint's second is not fresh" */
    it("is not fresh when its id sorts above the hint's", () => {
      const hintId = eventId({ second: NOW, writer: 1 });
      const answerId = eventId({ second: NOW, writer: 2 });
      expect(answerId > hintId).toBe(true);
      expect(isFresh({ answerId, hintId })).toBe(false);
    });

    it("is not fresh when its id sorts below the hint's", () => {
      const hintId = eventId({ second: NOW, writer: 2 });
      const answerId = eventId({ second: NOW, writer: 1 });
      expect(answerId < hintId).toBe(true);
      expect(isFresh({ answerId, hintId })).toBe(false);
    });
  });

  describe("when the same instance wrote a later event in the hint's second", () => {
    /** @scenario "An answer from another instance inside the hint's second is not fresh" */
    it("is not fresh, because only equality proves the hint's event is in", () => {
      const hintId = eventId({ second: NOW, writer: 1, sequenceId: 1 });
      const answerId = eventId({ second: NOW, writer: 1, sequenceId: 2 });
      expect(isFresh({ answerId, hintId })).toBe(false);
    });
  });

  describe("when an id is not a KSUID", () => {
    /** @scenario "An id that is not a KSUID is never fresh" */
    it("is not fresh as the answer", () => {
      expect(isFresh({ answerId: "not-an-id", hintId: eventId({ second: NOW, writer: 1 }) })).toBe(
        false,
      );
    });

    it("is not fresh as the hint", () => {
      expect(isFresh({ answerId: eventId({ second: NOW, writer: 1 }), hintId: "" })).toBe(false);
    });
  });
});
