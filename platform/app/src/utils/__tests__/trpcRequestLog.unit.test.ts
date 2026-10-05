import { afterEach, describe, expect, it, vi } from "vitest";
import { logTrpcOperation } from "../trpcRequestLog";

const secretInput = {
  headers: { Authorization: "Bearer header-value" },
  signingSecret: "signing-secret-value",
};

describe("logTrpcOperation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "The development request log never shows what a request carried" */
  it("logs the operation and its timing, and nothing a request carried", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {};

    logTrpcOperation({
      direction: "up",
      type: "mutation",
      path: "automation.testFire",
      id: 1,
      input: secretInput,
      context,
      signal: null,
    });
    logTrpcOperation({
      direction: "down",
      type: "mutation",
      path: "automation.testFire",
      id: 1,
      input: secretInput,
      context,
      signal: null,
      elapsedMs: 41.6,
      result: { result: { data: secretInput }, context },
    });

    const logged = log.mock.calls.flat().join("\n");
    expect(logged).toBe(
      ">> mutation automation.testFire\n<< mutation automation.testFire 42ms",
    );
    expect(logged).not.toContain("header-value");
    expect(logged).not.toContain("signing-secret-value");
  });
});
