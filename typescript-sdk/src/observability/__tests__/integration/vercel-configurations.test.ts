import { describe, it, expect } from "vitest";
import { registerOTel } from '@vercel/otel';
import { setupLangWatch } from "../../../client-node";
import { getLangWatchTracer } from "../../trace";

describe("Different Vercel AI configurations", () => {
  it("should work with a specific Vercel AI configuration", async () => {
    registerOTel({ serviceName: 'config-1', version: '1.0.0' });
    await setupLangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:9999",
      skipOpenTelemetrySetup: false,
    });

    const tracer = getLangWatchTracer("config-test");
    await tracer.withActiveSpan("test span", async () => {
      expect(true).toBe(true);
    });
  });
});
