import type IORedis from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForActiveJobs } from "../replayDrain";

describe("replay drain", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scans the tenant-scoped state queue until its active group drains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const scan = vi
      .fn()
      .mockResolvedValueOnce([
        "0",
        [
          "{event-sourcing/jobs}:gq:group:project-1/state/conversationState/conversation-1:active",
        ],
      ])
      .mockResolvedValueOnce(["0", []]);
    const redis = { scan } as unknown as IORedis;

    const drained = waitForActiveJobs({
      redis,
      aggregates: [
        {
          tenantId: "project-1",
          aggregateType: "langy_conversation",
          aggregateId: "conversation-1",
        },
      ],
      projectionName: "conversationState",
      kind: "state",
      maxWaitMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(200);
    await drained;

    expect(scan).toHaveBeenNthCalledWith(
      1,
      "0",
      "MATCH",
      "{event-sourcing/jobs}:gq:group:project-1/state/conversationState/*:active",
      "COUNT",
      500,
    );
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
