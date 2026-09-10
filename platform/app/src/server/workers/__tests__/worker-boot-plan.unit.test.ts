/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it } from "vitest";
import { resolveWorkerBootPlan } from "../worker-boot-plan";

describe("resolveWorkerBootPlan", () => {
  describe("given a normal worker", () => {
    it("boots the full stack", () => {
      const plan = resolveWorkerBootPlan({
        voiceWorkerOnly: false,
        shouldStartMetricsServer: true,
      });

      expect(plan).toEqual([
        "storage-stats",
        "scenario-processor",
        "nlp-fetch-teardown",
        "anomaly",
        "spend-spike-anomaly",
        "usage-stats",
        "realtime-session-poller",
        "metrics",
      ]);
    });
  });

  describe("given a voice worker", () => {
    /** @scenario "A voice worker boots only the voice subsystems" */
    it("boots only the scenario processor, media listener and metrics", () => {
      const plan = resolveWorkerBootPlan({
        voiceWorkerOnly: true,
        shouldStartMetricsServer: true,
      });

      expect(plan).toEqual([
        "scenario-processor",
        "nlp-fetch-teardown",
        "voice-ws-listener",
        "metrics",
      ]);
    });

    /** @scenario "A voice worker boots only the voice subsystems" */
    it("skips ingestion, anomaly, governance, poller and telemetry", () => {
      const plan = resolveWorkerBootPlan({
        voiceWorkerOnly: true,
        shouldStartMetricsServer: true,
      });

      expect(plan).not.toContain("storage-stats");
      expect(plan).not.toContain("anomaly");
      expect(plan).not.toContain("spend-spike-anomaly");
      expect(plan).not.toContain("realtime-session-poller");
      expect(plan).not.toContain("usage-stats");
    });
  });

  describe("given metrics are served elsewhere", () => {
    it("drops the metrics stage from either plan", () => {
      expect(
        resolveWorkerBootPlan({
          voiceWorkerOnly: true,
          shouldStartMetricsServer: false,
        }),
      ).not.toContain("metrics");
      expect(
        resolveWorkerBootPlan({
          voiceWorkerOnly: false,
          shouldStartMetricsServer: false,
        }),
      ).not.toContain("metrics");
    });
  });
});
