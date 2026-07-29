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
      it("reads a further rung off the message than the id's segment offers", () => {
        // The ladder that combines these is inlined in
        // `GroupQueue.handleTransientDecode` —
        // `Math.max(readJobAttempt(...) ?? 0, await this.readGroupAttempt(...),
        // legacyStagedJobAttempt(...)) + 1` — a private async method that needs
        // a live queue, so there is no resolver a unit test can call. Repeating
        // that `Math.max` here would pin the test to its own arithmetic rather
        // than to production, so this asserts what the two REAL readers hand
        // the ladder for one job: the message is further along, so the
        // last-resort id read cannot be what decides. The composition itself is
        // driven for real by `stagedJobIdIdentity.integration.test.ts`
        // ("A job staged under a legacy retry-suffixed id resumes its ladder
        // rather than restarting it").
        const value = JSON.stringify({ __attempt: 7 });
        const stagedJobId = `${BASE}/r/3`;

        expect(readJobAttempt(value)).toBe(7);
        expect(legacyStagedJobAttempt(stagedJobId)).toBe(3);
        expect(legacyStagedJobAttempt(stagedJobId)).toBeLessThan(
          readJobAttempt(value)!,
        );
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
