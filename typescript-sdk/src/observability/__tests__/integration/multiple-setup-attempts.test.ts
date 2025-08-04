import { describe, it, expect } from "vitest";
import { setup } from "../../../client-node";
import { getLangWatchTracer } from "../../trace";

describe("Multiple setup attempts and error handling", () => {
  it("should throw error when multiple LangWatch setups are called", async () => {
    // First setup
    await setup({
      apiKey: "test-key-1",
      endpoint: "http://localhost:9999",
      skipOpenTelemetrySetup: false,
    });

    // Second setup should throw an error
    await expect(setup({
      apiKey: "test-key-2",
      endpoint: "http://localhost:9999",
      skipOpenTelemetrySetup: false,
    })).rejects.toThrow("LangWatch setup has already been called");

    // Test that LangWatch still works
    const tracer = getLangWatchTracer("multiple-setup-test");
    await tracer.withActiveSpan("test span", async () => {
      expect(true).toBe(true);
    });
  });
});
