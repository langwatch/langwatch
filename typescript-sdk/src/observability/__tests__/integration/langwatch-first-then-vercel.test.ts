import { describe, it, expect } from "vitest";
import { registerOTel } from '@vercel/otel';
import { setup } from "../../../client-node";
import { getLangWatchTracer } from "../../trace";
import { isOtelInitialized } from "../../../client-shared";

describe("LangWatch setup first, then Vercel AI", () => {
  it("should work when LangWatch is set up first, then Vercel AI", async () => {
    // Setup LangWatch first
    await setup({
      apiKey: "test-key",
      endpoint: "http://localhost:9999",
      disableOpenTelemetryAutomaticSetup: false,
    });

    // Then setup Vercel AI
    registerOTel({ serviceName: 'langwatch-first' });

    // Test that LangWatch still works
    const tracer = getLangWatchTracer("langwatch-first-test");
    await tracer.withActiveSpan("test span", async () => {
      expect(true).toBe(true);
    });
  });
});
