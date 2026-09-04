// @vitest-environment node

/**
 * Leg 1 — an application records an LLM span and the platform can find it.
 *
 * Everything is asserted through the platform's read side, with a bounded
 * poll: an ingest that never lands must fail the leg by name rather than hang
 * (the OTLP body read hung for two minutes once, and looked like a slow test).
 */
import { describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";

import { attributes, getLangWatchTracer } from "../../../dist";
import { setupObservability } from "../../../dist/observability-sdk/setup/node";
import { READ_BUDGET_MS, apiKey, client, endpoint, pollUntil, unique } from "./support/journey";

describe("given an application that records LLM spans", () => {
  describe("when it records one LLM span and flushes", () => {
    // @scenario "An LLM span reaches the platform and is searchable"
    it("finds the trace on the platform with the input, output and token counts", async () => {
      const langwatch = client();
      const customerId = unique("sdk-app-customer");
      const observability = setupObservability({
        langwatch: { apiKey: apiKey(), endpoint: endpoint(), processorType: "simple" },
        serviceName: "sdk-app-journey",
        advanced: { UNSAFE_forceOpenTelemetryReinitialization: true },
      });

      const tracer = getLangWatchTracer("sdk-app-journey");
      let traceId = "";

      await tracer.withActiveSpan("answer-the-customer", async (span) => {
        traceId = span.spanContext().traceId;
        span.setType("llm");
        span.setAttributes({ [attributes.ATTR_LANGWATCH_CUSTOMER_ID]: customerId });
        span.setInput({ message: "What does LangWatch do?" });
        span.setOutput({ response: "It watches what your language models do." });
        span.setMetrics({ promptTokens: 11, completionTokens: 9 });
        span.setStatus({ code: SpanStatusCode.OK });
      });

      await observability.shutdown();

      const trace = await pollUntil({
        what: `the trace ${traceId}`,
        read: async () => {
          const found = await langwatch.traces.get(traceId, { includeSpans: true });
          return found?.spans?.length ? found : null;
        },
      });

      const span = trace.spans?.[0];
      expect(span?.type).toBe("llm");
      expect(span?.name).toBe("answer-the-customer");
      expect(JSON.stringify(span?.input)).toContain("What does LangWatch do?");
      expect(JSON.stringify(span?.output)).toContain("It watches what your language models do.");
      expect(span?.metrics?.prompt_tokens).toBe(11);
      expect(span?.metrics?.completion_tokens).toBe(9);
      expect(trace.metadata?.customer_id).toBe(customerId);
    }, READ_BUDGET_MS + 60_000);
  });

  describe("when it asks for a trace nothing ever posted", () => {
    // @scenario "A trace that never arrives fails the leg rather than hanging"
    it("gives up inside its own timeout with a named failure", async () => {
      const langwatch = client();
      const absent = `${"0".repeat(31)}1`;

      await expect(
        pollUntil({
          what: `the trace ${absent}`,
          read: async () => {
            const found = await langwatch.traces.get(absent, { includeSpans: true });
            return found?.spans?.length ? found : null;
          },
          timeoutMs: 6_000,
          intervalMs: 1_000,
        }),
      ).rejects.toThrow(/never arrived within 6000ms/);
    }, 30_000);
  });
});
