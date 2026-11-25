/**
 * The trace module's managed-version replay step: a background refold of the traceAnalytics lane
 * over the last 122 days, held until no older writer is left (goose 00133).
 */
import { toEpochMs } from "@langwatch/time";
import type { LaneReplayer } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { TRACE_ANALYTICS_PROJECTION_NAME } from "../eventing/trace-derived.projection.ts";
import { managedPromptVersionReplayStep } from "../trace.module.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Slack for Temporal's clock against Date.now(); far below the day the bound would be off by. */
const CLOCK_SLACK_MS = 1_000;

/** A replayer that records which lane it was asked to replay, and from when. */
function recordingReplayer(): LaneReplayer & { calls: { lane: string; since: string }[] } {
  const calls: { lane: string; since: string }[] = [];
  return {
    calls,
    async replayLane({ lane, since }) {
      calls.push({ lane, since });
      return { lane, kind: "fold", aggregatesReplayed: 0, totalEvents: 0, replayedThrough: since };
    },
  };
}

describe("the managed prompt version replay step", () => {
  describe("given the step the trace module declares", () => {
    it("is a background data step under its id that waits for the old writers to go", () => {
      const step = managedPromptVersionReplayStep({ replayer: recordingReplayer(), after: [] });

      expect(step).toMatchObject({
        id: "trace:replay-trace-analytics-managed-prompt-version",
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
      });
    });

    it("replays the traceAnalytics lane from 122 days before it was declared", async () => {
      const replayer = recordingReplayer();
      const declaredFrom = Date.now();
      const step = managedPromptVersionReplayStep({ replayer, after: [] });
      const declaredBy = Date.now();

      await step.run({
        checkpoint: { resumeFrom: null, save: async () => {} },
        dryRun: true,
        signal: new AbortController().signal,
        log: { info: () => undefined, warn: () => undefined },
      });

      expect(TRACE_ANALYTICS_PROJECTION_NAME).toBe("traceAnalytics");
      expect(replayer.calls.map(({ lane }) => lane)).toEqual([TRACE_ANALYTICS_PROJECTION_NAME]);
      const sinceMs = toEpochMs(replayer.calls[0]?.since ?? "");
      expect(sinceMs).toBeGreaterThanOrEqual(declaredFrom - 122 * DAY_MS - CLOCK_SLACK_MS);
      expect(sinceMs).toBeLessThanOrEqual(declaredBy - 122 * DAY_MS + CLOCK_SLACK_MS);
    });
  });
});
