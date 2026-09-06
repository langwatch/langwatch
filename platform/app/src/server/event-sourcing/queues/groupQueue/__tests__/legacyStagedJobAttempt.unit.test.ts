import { describe, expect, it } from "vitest";
import { JOB_RETRY_CONFIG } from "../../shared";
import { readJobAttempt } from "../jobEnvelope";
import { legacyStagedJobAttempt } from "../legacyStagedJobAttempt";

const BASE =
  "event_000649zPnIW3V0Ug6yVk9DECNYK3S/subscriber/pm:langyConversation";

describe("legacyStagedJobAttempt", () => {
  describe("given a legacy id carrying a retry segment", () => {
    describe("when the attempt is taken from a message that records one", () => {
      /** @scenario A legacy id's retry segment is read only when nothing else can answer */
      it("believes the message and ignores the id's segment", () => {
        // The ladder takes the highest of (message, group chain, legacy id), so
        // a message that can answer always wins over a stale id segment.
        const value = JSON.stringify({ __attempt: 7 });

        expect(
          Math.max(
            readJobAttempt(value) ?? 0,
            legacyStagedJobAttempt(`${BASE}/r/3`),
          ),
        ).toBe(7);
      });
    });
  });

  describe("given an id from before the retry count moved to the message", () => {
    describe("when its attempt is read", () => {
      it("takes the furthest rung the chain reached", () => {
        expect(legacyStagedJobAttempt(`${BASE}/r/12/r/16/r/24`)).toBe(24);
      });

      it("reads a single segment", () => {
        expect(legacyStagedJobAttempt(`${BASE}/r/5`)).toBe(5);
      });

      it("reads nothing from an id that never retried", () => {
        expect(legacyStagedJobAttempt(BASE)).toBe(0);
      });
    });
  });

  describe("given a legacy id whose terminal segment is a wall-clock stamp", () => {
    describe("when its attempt is read", () => {
      it("does not mistake the timestamp for an attempt", () => {
        // `/r/${Date.now()}` shared the retry marker. Read as a count it would
        // vault past the budget and discard a job that still had rungs left.
        const withStamp = `${BASE}/r/12/r/16/r/24/r/1785261278310`;

        expect(legacyStagedJobAttempt(withStamp)).toBe(24);
        expect(legacyStagedJobAttempt(`${BASE}/r/1785261278310`)).toBe(0);
      });

      it("ignores a segment one past the ladder's last rung", () => {
        // The real boundary: maxAttempts reads, maxAttempts + 1 does not, so a
        // stamp can never be mistaken for a count no matter how small.
        expect(
          legacyStagedJobAttempt(`${BASE}/r/${JOB_RETRY_CONFIG.maxAttempts}`),
        ).toBe(JOB_RETRY_CONFIG.maxAttempts);
        expect(
          legacyStagedJobAttempt(
            `${BASE}/r/${JOB_RETRY_CONFIG.maxAttempts + 1}`,
          ),
        ).toBe(0);
      });
    });
  });

  describe("given an id whose own name contains the marker's shape", () => {
    describe("when its attempt is read", () => {
      it("ignores a segment that is not a bare number", () => {
        expect(legacyStagedJobAttempt(`${BASE}/r/x`)).toBe(0);
        expect(legacyStagedJobAttempt("event_1/r/inner/subscriber/pm:x")).toBe(
          0,
        );
      });
    });
  });
});
