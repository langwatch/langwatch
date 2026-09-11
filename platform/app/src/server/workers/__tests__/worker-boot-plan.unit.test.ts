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
      "scenario-processor",
      "nlp-fetch-teardown",
      "voice-ws-listener",
      "anomaly",
      "spend-spike-anomaly",
      "usage-stats",
      "realtime-session-poller",
      "metrics",
    ]);
  });

  describe("given metrics are served elsewhere", () => {
    it("drops the metrics stage from the plan", () => {
      expect(
        resolveWorkerBootPlan({ shouldStartMetricsServer: false }),
      ).not.toContain("metrics");
    });
  });
});
