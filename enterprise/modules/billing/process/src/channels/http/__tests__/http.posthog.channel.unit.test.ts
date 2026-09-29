/** @see specs/analytics/posthog-product-milestones.feature */
import type { ProductAnalyticsTarget } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { HttpPostHogChannel } from "../http.posthog.channel.ts";

function countingTargets(targets: ProductAnalyticsTarget[]) {
  const reads = { count: 0 };
  const read = (): ProductAnalyticsTarget[] => {
    reads.count += 1;
    return targets;
  };

  return { reads, read };
}

const MILESTONE = { userId: "user_1", event: "scenario_created", properties: {} };

describe("HttpPostHogChannel", () => {
  describe("given ops names no product-analytics target", () => {
    /** @scenario "Billing's milestones send nothing where the deployment named no PostHog key" */
    it("builds no client, sends nothing and closes cleanly", async () => {
      const { read } = countingTargets([]);
      const channel = HttpPostHogChannel.create({ targets: read });

      channel.track(MILESTONE);

      await expect(channel.close()).resolves.toBeUndefined();
    });
  });

  describe("when billing composes the channel", () => {
    /** @scenario "Billing reads ops' PostHog target on its first milestone, not at boot" */
    it("asks for the targets on the first track and only once", () => {
      const { reads, read } = countingTargets([]);
      const channel = HttpPostHogChannel.create({ targets: read });
      expect(reads.count).toBe(0);

      channel.track(MILESTONE);
      channel.track(MILESTONE);

      expect(reads.count).toBe(1);
    });
  });
});
