/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it } from "vitest";
import { resolveWorkerBootPlan } from "../worker-boot-plan";

describe("resolveWorkerBootPlan", () => {
  /** @scenario "A worker's boot plan always includes the voice media listener" */
  it("boots the full stack including the voice media listener", () => {
    const plan = resolveWorkerBootPlan({ shouldStartMetricsServer: true });

    expect(plan).toEqual([
      "storage-stats",
      "voice-ws-listener",
      "scenario-processor",
      "nlp-fetch-teardown",
      "anomaly",
      "spend-spike-anomaly",
      "usage-stats",
      "realtime-session-poller",
      "metrics",
    ]);
  });

  describe("given the scenario processor claims jobs as soon as it boots", () => {
    it("binds the voice media listener before the scenario processor", () => {
      // A voice job claimed in the gap between the two stages would build
      // TwiML naming a media socket nothing is listening on yet, and the
      // inbound call would fail on connect. The listener has to win the race.
      const plan = resolveWorkerBootPlan({ shouldStartMetricsServer: true });

      expect(plan.indexOf("voice-ws-listener")).toBeLessThan(
        plan.indexOf("scenario-processor"),
      );
    });
  });

  describe("given metrics are served elsewhere", () => {
    it("drops the metrics stage from the plan", () => {
      expect(
        resolveWorkerBootPlan({ shouldStartMetricsServer: false }),
      ).not.toContain("metrics");
    });
  });
});
