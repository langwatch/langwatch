import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnomalyWorkerContributionAdapter } from "../ops-worker-contribution.service.ts";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
  // The ops package index now reaches @langwatch/api/trpc, which pulls the warn throttle in.
  createWarnThrottle: () => ({ claim: () => 0 }),
}));

describe("Ops worker contributions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "The anomaly worker preserves its settling delay and retry interval" */
  it("starts anomaly detection after the existing five-second settling delay", async () => {
    const detector = { tick: vi.fn(async () => ({ surfaced: 0, cleared: 0 })) };
    const handle = AnomalyWorkerContributionAdapter.create({ detector }).start();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(detector.tick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await handle.stop();
    expect(detector.tick).toHaveBeenCalledTimes(1);
  });

  it("retries a failed anomaly tick on its sixty-second interval", async () => {
    const detector = {
      tick: vi
        .fn<() => Promise<{ surfaced: number; cleared: number }>>()
        .mockRejectedValueOnce(new Error("redis unavailable"))
        .mockResolvedValue({ surfaced: 0, cleared: 0 }),
    };
    const handle = AnomalyWorkerContributionAdapter.create({ detector }).start();

    await vi.advanceTimersByTimeAsync(5_000 + 60_000);
    await handle.stop();

    expect(detector.tick).toHaveBeenCalledTimes(2);
  });
});
