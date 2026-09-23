/** @see modules/onboarding/specs/onboarding-product-analytics.feature */
import type { ProductAnalyticsTarget } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { HttpPostHogEventsChannel } from "../http.posthog-events.channel.ts";

function countingTargets(targets: ProductAnalyticsTarget[]) {
  const reads = { count: 0 };
  const read = (): ProductAnalyticsTarget[] => {
    reads.count += 1;
    return targets;
  };

  return { reads, read };
}

const EVENT = { userId: "user_1", event: "guided_onboarding_paths_selected", properties: {} };

describe("HttpPostHogEventsChannel", () => {
  /** @scenario "A deployment without a product-analytics target sends nothing" */
  it("builds no client and closes cleanly when ops names no target", async () => {
    const { read } = countingTargets([]);
    const channel = HttpPostHogEventsChannel.create({ targets: read });

    channel.track(EVENT);

    await expect(channel.close()).resolves.toBeUndefined();
  });

  /** @scenario "The target is read on the first event, not at construction" */
  it("asks for the targets on the first track and only once", () => {
    const { reads, read } = countingTargets([]);
    const channel = HttpPostHogEventsChannel.create({ targets: read });
    expect(reads.count).toBe(0);

    channel.track(EVENT);
    channel.track(EVENT);

    expect(reads.count).toBe(1);
  });
});
