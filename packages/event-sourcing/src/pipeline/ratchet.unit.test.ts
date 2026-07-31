import { describe, expect, it } from "vitest";
import { checkTypeStringRatchet, mergeSnapshot } from "./ratchet";

/**
 * The ratchet turns a silent orphaning of stored rows into a diff a reviewer
 * reads. One implementation covers both events and intents (ADR-105 decision
 * 10) — the tests below use plain declaration names throughout, since the
 * comparison itself does not care which kind of type string it is looking at.
 */
describe("checkTypeStringRatchet", () => {
  describe("given a declaration that keeps every type string it declared last time", () => {
    /** @scenario a new event type on an existing declaration is free */
    it("reports nothing when it also declares a further type string", () => {
      const snapshot = { trace: ["trace/span_received"] };
      const current = {
        trace: ["trace/span_received", "trace/topic_assigned"],
      };
      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([]);
    });
  });

  describe("given a declaration the snapshot has never seen before", () => {
    /** @scenario a brand-new declaration is never a violation */
    it("never reports the new declaration's type strings", () => {
      const snapshot = { trace: ["trace/span_received"] };
      const current = {
        trace: ["trace/span_received"],
        log: ["log/record_received"],
      };
      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([]);
    });
  });

  describe("given no snapshot has ever been committed", () => {
    /** @scenario a first-ever snapshot commits without complaint */
    it("accepts everything declared now", () => {
      const current = { trace: ["trace/span_received"] };
      expect(checkTypeStringRatchet({ snapshot: {}, current })).toEqual([]);
    });
  });

  describe("given a declaration renames one of its type strings", () => {
    /** @scenario renaming a map key orphans the stored rows carrying the old string */
    it("reports the old string as missing under that declaration", () => {
      const snapshot = { trace: ["trace/span_received"] };
      const current = { trace: ["trace/span_arrived"] };

      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([
        { declaration: "trace", missing: ["trace/span_received"] },
      ]);
    });
  });

  describe("given the current declarations no longer mention a declaration at all", () => {
    /** @scenario dropping a declaration entirely orphans every one of its stored type strings */
    it("reports every type string that declaration ever declared as missing", () => {
      const snapshot = {
        trace: ["trace/span_received", "trace/topic_assigned"],
      };

      expect(checkTypeStringRatchet({ snapshot, current: {} })).toEqual([
        {
          declaration: "trace",
          missing: ["trace/span_received", "trace/topic_assigned"],
        },
      ]);
    });
  });

  describe("given a process manager renames one of its declared intent keys", () => {
    /** @scenario an intent's type string is ratcheted the same way an event's is */
    it("reports the old intent type as missing under that process manager", () => {
      const snapshot = { settlement: ["settlement/notifyDigest"] };
      const current = { settlement: ["settlement/notifyMatch"] };

      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([
        { declaration: "settlement", missing: ["settlement/notifyDigest"] },
      ]);
    });
  });
});

describe("mergeSnapshot", () => {
  describe("given a snapshot and current declarations that add new type strings", () => {
    /** @scenario the committed file gains only what was added */
    it("carries every type string from both, deduplicated", () => {
      const snapshot = { trace: ["trace/span_received"] };
      const current = {
        trace: ["trace/span_received", "trace/topic_assigned"],
      };

      expect(mergeSnapshot({ snapshot, current })).toEqual({
        trace: ["trace/span_received", "trace/topic_assigned"],
      });
    });

    it("loses nothing that was already committed", () => {
      const snapshot = { trace: ["trace/topic_assigned"] };
      const current = { trace: ["trace/span_received"] };

      const merged = mergeSnapshot({ snapshot, current });
      expect(merged.trace).toContain("trace/topic_assigned");
      expect(merged.trace).toContain("trace/span_received");
    });
  });

  describe("given a snapshot that has already been merged with the current declarations", () => {
    /** @scenario a merge that changes nothing produces a byte-identical result */
    it("produces an unchanged result when merged again against its own output", () => {
      const snapshot = { trace: ["trace/span_received"] };
      const current = {
        trace: ["trace/span_received", "trace/topic_assigned"],
      };

      const once = mergeSnapshot({ snapshot, current });
      const twice = mergeSnapshot({ snapshot: once, current: once });
      expect(twice).toEqual(once);
    });
  });
});
