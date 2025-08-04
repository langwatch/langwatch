import { describe, it, expect } from "vitest";
import { registerOTel } from '@vercel/otel';
import { setupLangWatch } from "../../../client-node";
import { getLangWatchTracer } from "../../trace";

describe("Error handling with Vercel AI", () => {
  it("should handle errors gracefully when both are set up", async () => {
    registerOTel({ serviceName: 'error-test' });
    await setupLangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:9999",
      skipOpenTelemetrySetup: false,
    });

    const tracer = getLangWatchTracer("error-otel-test");

    // Test that exceptions in spans are properly handled
    await expect(
      tracer.withActiveSpan("error span", async () => {
        throw new Error("Test error");
      })
    ).rejects.toThrow("Test error");
  });
});
