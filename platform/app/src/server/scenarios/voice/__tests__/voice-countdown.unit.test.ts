/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it } from "vitest";
import { isRedCountdown, remainingSeconds } from "../voice-countdown";

describe("voice countdown", () => {
  describe("given a call duration limit", () => {
    /** @scenario "The countdown math flags the final 60 seconds of the call" */
    it("flags the red window at or below 60 seconds remaining and not above", () => {
      const max = 90;

      // 60s or fewer before the limit → flagged.
      const nearEnd = remainingSeconds({ elapsedMs: 45_000, maxCallSeconds: max });
      expect(nearEnd).toBe(45);
      expect(isRedCountdown(nearEnd)).toBe(true);

      // More than 60s before the limit → not flagged.
      const early = remainingSeconds({ elapsedMs: 10_000, maxCallSeconds: max });
      expect(early).toBe(80);
      expect(isRedCountdown(early)).toBe(false);
    });

    it("does not flag red once the limit has elapsed", () => {
      const remaining = remainingSeconds({
        elapsedMs: 95_000,
        maxCallSeconds: 90,
      });
      expect(remaining).toBe(0);
      expect(isRedCountdown(remaining)).toBe(false);
    });
  });
});
