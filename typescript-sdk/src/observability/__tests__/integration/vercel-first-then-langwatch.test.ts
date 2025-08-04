import { describe, it, expect } from "vitest";
import { registerOTel } from '@vercel/otel';
import { setup } from "../../../client-node";
import { getLangWatchTracer } from "../../trace";
import { isOtelInitialized } from "../../../client-shared";

describe("Vercel AI setup first, then LangWatch", () => {
  it("should work when Vercel AI is set up first, then LangWatch", async () => {
    // Setup Vercel AI first
    registerOTel({ serviceName: 'vercel-first' });

    expect(isOtelInitialized()).toBe(true);

    // Then setup LangWatch
    await setup({
      apiKey: "test-key",
      endpoint: "http://localhost:9999",
      skipOpenTelemetrySetup: false,
    });

    // Test that LangWatch still works
    const tracer = getLangWatchTracer("vercel-first-test");
    await tracer.withActiveSpan("test span", async () => {
      expect(true).toBe(true);
    });
  });
});
