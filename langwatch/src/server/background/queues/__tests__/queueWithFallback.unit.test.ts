import { describe, expect, it, vi } from "vitest";

// Force the no-connection path so we exercise the inline-fallback decision
// without a real Redis.
vi.mock("../../../redis", () => ({ connection: undefined }));

import { QueueWithFallback } from "../queueWithFallback";

describe("QueueWithFallback inline-fallback gating", () => {
  it("runs the worker inline when unavailable and fallback is enabled (default)", async () => {
    const worker = vi.fn().mockResolvedValue("done");
    const queue = new QueueWithFallback<{ x: number }, string, string>(
      "q-default",
      worker,
      {},
    );

    const result = await queue.add("job", { x: 1 });

    expect(worker).toHaveBeenCalledTimes(1);
    expect(result).toBe("done");
  });

  it("throws instead of running inline when fallback is disabled", async () => {
    const worker = vi.fn().mockResolvedValue("done");
    const queue = new QueueWithFallback<{ x: number }, string, string>(
      "q-no-inline",
      worker,
      {},
      { fallbackToInline: false },
    );

    await expect(queue.add("job", { x: 1 })).rejects.toThrow();
    expect(worker).not.toHaveBeenCalled();
  });
});
