import { describe, expect, it, vi } from "vitest";
import { AppTracePrivacyRuntime } from "../trace-privacy.runtime";

describe("AppTracePrivacyRuntime", () => {
  it("closes the tokenizer after a transport failure and rethrows that first failure", async () => {
    const transportFailure = new Error("transport failed");
    const transport = { close: vi.fn().mockRejectedValue(transportFailure) };
    const tokenizer = { close: vi.fn().mockResolvedValue(undefined) };

    await expect(
      AppTracePrivacyRuntime.prototype.close.call({ transport, tokenizer }),
    ).rejects.toBe(transportFailure);
    expect(tokenizer.close).toHaveBeenCalledOnce();
  });
});
