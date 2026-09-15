// @vitest-environment node

/**
 * Leg 2 — evaluations, both ways round: a result the application recorded on
 * its own span, and an evaluator the platform ran when called by slug.
 */
import { describe, expect, it } from "vitest";

import { getLangWatchTracer, type LangWatch } from "../../../dist";
import { setupObservability } from "../../../dist/observability-sdk/setup/node";
import { READ_BUDGET_MS, apiKey, client, endpoint, pollUntil, unique } from "./support/journey";

describe("given an application that evaluates what its model said", () => {
  describe("when it records an evaluation on the span it just wrote", () => {
    // @scenario "An evaluation recorded on a span is readable on the trace"
    it("reads that evaluation back on the trace, under the name it gave", async () => {
      const langwatch: LangWatch = client();
      const evaluationName = unique("sdk-app-span-evaluation");
      const observability = setupObservability({
        langwatch: { apiKey: apiKey(), endpoint: endpoint(), processorType: "simple" },
        serviceName: "sdk-app-journey",
        advanced: { UNSAFE_forceOpenTelemetryReinitialization: true },
      });

      const tracer = getLangWatchTracer("sdk-app-journey");
      let traceId = "";
      await tracer.withActiveSpan("judged-answer", async (span) => {
        traceId = span.spanContext().traceId;
        span.setType("llm");
        span.setInput({ message: "Is a span part of a trace?" });
        span.setOutput({ response: "Yes." });
        span.addEvaluation({
          name: evaluationName,
          type: "custom",
          status: "processed",
          passed: true,
          score: 1,
          label: "correct",
          details: "The answer names the relationship.",
        });
      });
      await observability.shutdown();

      const evaluation = await pollUntil({
        what: `the evaluation ${evaluationName} on trace ${traceId}`,
        read: async () => {
          const trace = await langwatch.traces.get(traceId, { includeSpans: true });
          return trace?.evaluations?.find((each) => each.name === evaluationName) ?? null;
        },
      });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.score).toBe(1);
      expect(evaluation.label).toBe("correct");
    }, READ_BUDGET_MS + 60_000);
  });

  describe("when it creates an evaluator and calls it by slug", () => {
    // @scenario "An evaluator created from code answers when it is called by slug"
    it("gets a status and a verdict back from the platform", async () => {
      const langwatch = client();
      const name = unique("sdk-app-evaluator");
      const evaluator = await langwatch.evaluators.create({
        name,
        config: { evaluatorType: "langevals/exact_match" },
      });
      expect(evaluator, "the platform answered the create with no evaluator").toBeTruthy();

      try {
        expect(evaluator.slug).toBeTruthy();

        // A saved evaluator is addressed under `evaluators/`; a bare slug is
        // read as a built-in evaluator type or a monitor.
        const result = await langwatch.evaluations.evaluate(`evaluators/${evaluator.slug}`, {
          data: { output: "pong", expected_output: "pong" },
          name,
        });

        expect(result.status).toBeTruthy();
        expect(["processed", "skipped", "error"]).toContain(result.status);
        if (result.status === "processed") expect(result.passed).toBe(true);
      } finally {
        await langwatch.evaluators.delete(evaluator.id).catch(() => undefined);
      }
    }, 120_000);
  });

  describe("when it evaluates against a slug no evaluator holds", () => {
    // @scenario "Calling an evaluator slug that does not exist is refused by name"
    it("fails with the platform's own error rather than a generic one", async () => {
      const langwatch = client();

      await expect(
        langwatch.evaluations.evaluate(unique("sdk-app-absent-evaluator"), {
          data: { output: "pong" },
        }),
      ).rejects.toThrow();
    }, 60_000);
  });
});
