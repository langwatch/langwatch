import { describe, expect, it, vi } from "vitest";
import { RedisSchedulerWakeAdapter } from "../src";

describe("RedisSchedulerWakeAdapter", () => {
  it("publishes a best-effort scheduler wake", async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const wake = RedisSchedulerWakeAdapter.create({ publish });

    wake.wake();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith("scheduler:wake", "1"));
  });

  it("does not propagate a failed wake publish", async () => {
    const publish = vi.fn().mockRejectedValue(new Error("redis unavailable"));
    const wake = RedisSchedulerWakeAdapter.create({ publish });

    expect(() => wake.wake()).not.toThrow();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
  });
});
