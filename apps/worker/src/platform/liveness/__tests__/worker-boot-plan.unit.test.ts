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
      "metrics",
      "storage-stats",
      "voice-ws-listener",
      "scenario-processor",
      "nlp-fetch-teardown",
      "anomaly",
      "spend-spike-anomaly",
      "usage-stats",
      "realtime-session-poller",
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

  describe("given the voice tunnel can take minutes to mint on a cold binary download", () => {
    /** @scenario "The liveness server boots before every other stage, including the voice tunnel" */
    it("puts the metrics stage first in the plan", () => {
      // startWorkers boots the "metrics" stage (the kubelet liveness thread)
      // as soon as it appears in the plan, before it resolves the voice
      // public URL tunnel — a slow cloudflared download or slow trycloudflare
      // DNS must not leave /healthz unanswered past the kubelet's liveness
      // budget (prod: ~90s) or the pod is killed mid-mint, crash-looping the
      // rollout. Pinning "metrics" first here is what makes that true.
      const plan = resolveWorkerBootPlan({ shouldStartMetricsServer: true });

      expect(plan[0]).toBe("metrics");
    });
  });
});
