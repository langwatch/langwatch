import { describe, expect, it } from "vitest";
import { deriveInboxKey } from "../inboxKey";

const SHORT = "event_000649zPnIW3V0Ug6yVk9DECNYK3S";
const LONG = `project_x:langyconv_1:tool-start:${"a".repeat(3000)}`;

describe("deriveInboxKey", () => {
  describe("given a source event id", () => {
    describe("when its inbox key is derived twice", () => {
      /** @scenario The same source event id always derives the same key */
      it("produces the same value both times", () => {
        expect(deriveInboxKey(SHORT)).toBe(deriveInboxKey(SHORT));
        expect(deriveInboxKey(LONG)).toBe(deriveInboxKey(LONG));
      });
    });
  });

  describe("given a very short source event id and a very long one", () => {
    describe("when each one's inbox key is derived", () => {
      /** @scenario The derived key is a fixed width regardless of input length */
      it("derives keys of the same length", () => {
        expect(deriveInboxKey(SHORT)).toHaveLength(deriveInboxKey(LONG).length);
      });

      /** @scenario The derived key is a fixed width regardless of input length */
      it("keeps that length far under the btree index limit", () => {
        // Postgres refuses a btree index row past ~2704 bytes; the constraint
        // also carries processName and projectId, so the key's own width is
        // what has to stay small.
        expect(deriveInboxKey(LONG).length).toBeLessThan(100);
      });
    });
  });

  describe("given two long ids that differ only at the very end", () => {
    describe("when each one's inbox key is derived", () => {
      it("keeps them distinct", () => {
        expect(deriveInboxKey(`${LONG}a`)).not.toBe(deriveInboxKey(`${LONG}b`));
      });
    });
  });
});
