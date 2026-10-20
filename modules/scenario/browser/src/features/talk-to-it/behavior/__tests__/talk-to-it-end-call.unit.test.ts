/**
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it, vi } from "vitest";

import { createTalkRefs } from "../talk-to-it-refs.ts";
import { runEndCall } from "../talk-to-it-start.ts";

const clock = vi.hoisted(() => ({ now: 0 }));

vi.mock("@langwatch/time", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  nowInstant: () => ({ epochMilliseconds: clock.now }),
}));

const CALL_START_MS = 1_000_000;
const HANG_UP_MS = CALL_START_MS + 50_000;
const PAST_CEILING_MS = CALL_START_MS + 10 * 60_000;

describe("runEndCall", () => {
  describe("when hangUp's disconnect callback re-enters after the clock passes the ceiling", () => {
    it("keeps the first end instant and finishes exactly once", async () => {
      clock.now = CALL_START_MS;
      const refs = createTalkRefs(undefined);
      refs.startedAt.current = CALL_START_MS;
      const dispatch = vi.fn();
      const endedAtSeenByFinish: number[] = [];
      const finish = vi.fn(async () => {
        endedAtSeenByFinish.push(refs.endedAt.current);
      });

      refs.session.current = {
        hangUp: async () => {
          clock.now = PAST_CEILING_MS;
          await runEndCall({ refs, dispatch, finish, isCutAtLimit: false });
        },
      };

      clock.now = HANG_UP_MS;
      await runEndCall({ refs, dispatch, finish, isCutAtLimit: false });

      expect(refs.endedAt.current).toBe(HANG_UP_MS);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(endedAtSeenByFinish).toEqual([HANG_UP_MS]);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({ type: "HANG_UP" });
    });
  });
});
