import { describe, expect, it } from "vitest";
import {
  checkTypeStringRatchet,
  mergeSnapshot,
  type TypeStringSnapshot,
} from "./ratchet";

/**
 * The ratchet exists to turn an orphaned event type string into a visible
 * diff (ADR-105 §3), so these tests are about that asymmetry: an addition is
 * always free, a disappearance is always caught, and the report names exactly
 * which aggregate and which strings so the diff is actionable rather than a
 * bare boolean.
 */

describe("checkTypeStringRatchet", () => {
  describe("given only additions", () => {
    /** @scenario a new event type on an existing aggregate is free */
    it("passes when an aggregate gains a type string", () => {
      const snapshot: TypeStringSnapshot = { trace: ["started"] };
      const current: TypeStringSnapshot = { trace: ["started", "ended"] };
      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([]);
    });

    /** @scenario a brand-new aggregate is never a violation */
    it("passes when current declares an aggregate the snapshot never saw", () => {
      const snapshot: TypeStringSnapshot = { trace: ["started"] };
      const current: TypeStringSnapshot = {
        trace: ["started"],
        session: ["opened"],
      };
      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([]);
    });
  });

  describe("given an empty snapshot", () => {
    /** @scenario a first-ever snapshot commits without complaint */
    it("accepts anything current declares", () => {
      const current: TypeStringSnapshot = {
        trace: ["started", "ended"],
        session: ["opened"],
      };
      expect(
        checkTypeStringRatchet({ snapshot: {}, current }),
      ).toEqual([]);
    });
  });

  describe("given a renamed event type", () => {
    /** @scenario renaming a map key orphans the stored rows carrying the old string */
    it("reports the old string as missing under its aggregate", () => {
      const snapshot: TypeStringSnapshot = { trace: ["started", "ended"] };
      const current: TypeStringSnapshot = { trace: ["begun", "ended"] };
      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([
        { aggregate: "trace", missing: ["started"] },
      ]);
    });

    it("reports every missing string across multiple aggregates", () => {
      const snapshot: TypeStringSnapshot = {
        trace: ["started", "ended"],
        session: ["opened", "closed"],
      };
      const current: TypeStringSnapshot = {
        trace: ["begun", "ended"],
        session: ["opened", "closed"],
      };
      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([
        { aggregate: "trace", missing: ["started"] },
      ]);
    });
  });

  describe("given a removed aggregate", () => {
    /** @scenario dropping an aggregate entirely orphans every one of its stored event types */
    it("reports all of its type strings as missing", () => {
      const snapshot: TypeStringSnapshot = {
        trace: ["started", "ended"],
        session: ["opened"],
      };
      const current: TypeStringSnapshot = { trace: ["started", "ended"] };
      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([
        { aggregate: "session", missing: ["opened"] },
      ]);
    });
  });
});

describe("mergeSnapshot", () => {
  describe("given a snapshot and a current declaration", () => {
    /** @scenario the committed file gains only what was added */
    it("unions the type strings per aggregate, sorted and deduped", () => {
      const snapshot: TypeStringSnapshot = { trace: ["started"] };
      const current: TypeStringSnapshot = {
        trace: ["ended", "started"],
        session: ["opened"],
      };
      expect(mergeSnapshot({ snapshot, current })).toEqual({
        session: ["opened"],
        trace: ["ended", "started"],
      });
    });

    /** @scenario a merge that changes nothing produces a byte-identical result */
    it("is stable when applied again with the same current", () => {
      const snapshot: TypeStringSnapshot = { trace: ["started"] };
      const current: TypeStringSnapshot = { trace: ["ended", "started"] };
      const once = mergeSnapshot({ snapshot, current });
      const twice = mergeSnapshot({ snapshot: once, current });
      expect(twice).toEqual(once);
    });
  });

  describe("given an empty snapshot", () => {
    it("merges to exactly what current declares", () => {
      const current: TypeStringSnapshot = { trace: ["ended", "started"] };
      expect(mergeSnapshot({ snapshot: {}, current })).toEqual({
        trace: ["ended", "started"],
      });
    });
  });
});
