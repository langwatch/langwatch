/**
 * specs/typescript-sdk/observability-otel-env-configuration.feature
 */
import { InMemorySpanExporter, TracerProvider } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterableBatchSpanProcessor } from "../filterable-batch-span-processor";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("FilterableBatchSpanProcessor", () => {
  describe("when OTEL_BSP_MAX_QUEUE_SIZE is set", () => {
    /** @scenario "Batch span processors take their queue and timing from OTEL_BSP_ variables" */
    it("queues no more spans than it allows", async () => {
      vi.stubEnv("OTEL_BSP_MAX_QUEUE_SIZE", "1");
      vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "60000");
      const exporter = new InMemorySpanExporter();
      const provider = new TracerProvider({
        spanProcessors: [new FilterableBatchSpanProcessor(exporter, [])],
      });
      const tracer = provider.getTracer("env-test");

      for (const name of ["first", "second", "third"]) tracer.startSpan(name).end();
      await provider.forceFlush();

      // The default queue of 2048 would keep all three.
      expect(exporter.getFinishedSpans().length).toBeLessThan(3);
      await provider.shutdown();
    });
  });
});
