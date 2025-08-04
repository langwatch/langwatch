import { describe, it, expect } from "vitest";
import { registerOTel } from '@vercel/otel';
import { setup } from "../../../client-node";
import { getLangWatchTracer } from "../../trace";

describe("Complex nested spans with Vercel AI", () => {
  it("should work with complex nested spans when Vercel AI is set up first", async () => {
    registerOTel({ serviceName: 'complex-test' });
    await setup({
      apiKey: "test-key",
      endpoint: "http://localhost:9999",
      skipOpenTelemetrySetup: false,
    });

    const tracer = getLangWatchTracer("complex-otel-test");

    await tracer.withActiveSpan("root span", async () => {
      await tracer.withActiveSpan("child span 1", async () => {
        await tracer.withActiveSpan("grandchild span", async () => {
          expect(true).toBe(true);
        });
      });

      await tracer.withActiveSpan("child span 2", async () => {
        expect(true).toBe(true);
      });
    });
  });
});
