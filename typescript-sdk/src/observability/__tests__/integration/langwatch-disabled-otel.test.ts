import { describe, it, expect } from "vitest";
import { registerOTel } from '@vercel/otel';
import { setup } from "../../../client-node";
import { getLangWatchTracer } from "../../trace";

describe("LangWatch with disableOpenTelemetryAutomaticSetup=true", () => {
  it("should work when LangWatch is set up with disableOpenTelemetryAutomaticSetup=true", async () => {
    // Setup Vercel AI first
    registerOTel({ serviceName: 'vercel-first' });

    // Then setup LangWatch with automatic setup disabled
    await setup({
      apiKey: "test-key",
      endpoint: "http://localhost:9999",
      disableOpenTelemetryAutomaticSetup: true,
    });

    // Test that LangWatch still works
    const tracer = getLangWatchTracer("disabled-otel-test");
    await tracer.withActiveSpan("test span", async () => {
      expect(true).toBe(true);
    });
  });
});
