import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { AiQueryProviderError, type TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceAiQueryService } from "../trace-ai-query.service.ts";

const RANGE = { from: 1_000, to: 2_000 };
const KNOWN = { evaluators: [], events: [] };

function compose() {
  const generateText = vi.fn<ModelProviderApi["generateText"]>(async () => ({ text: "" }));
  const generateStructured = vi.fn<ModelProviderApi["generateStructured"]>(async () => ({}));
  const readFacetValues = vi.fn<TraceApi["readFacetValues"]>(async () => {
    throw new Error("facets down");
  });
  const service = TraceAiQueryService.create({
    models: { generateText, generateStructured },
    facets: { readFacetValues },
  });
  return { service, generateText, generateStructured };
}

describe("TraceAiQueryService", () => {
  describe("when generateTraceQueryFromPrompt translates a sentence", () => {
    it("returns the sanitised query when it parses", async () => {
      const { service, generateText } = compose();
      generateText.mockResolvedValueOnce({ text: "```\nquery: status:error\n```" });
      await expect(
        service.generateTraceQueryFromPrompt({
          projectId: "p1",
          prompt: "errors",
          timeRange: RANGE,
        }),
      ).resolves.toEqual({ ok: true, query: "status:error", attempts: 1 });
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({ featureKey: "traces.ai_search", temperature: 0 }),
      );
    });

    it("feeds the parse failure back and gives up after three attempts", async () => {
      const { service, generateText } = compose();
      const result = await service.generateTraceQueryFromPrompt({
        projectId: "p1",
        prompt: "good ones",
        timeRange: RANGE,
      });
      expect(result).toEqual({ ok: false, lastQuery: "", lastError: "Empty query.", attempts: 3 });
      expect(generateText).toHaveBeenCalledTimes(3);
    });
  });

  describe("when generateTraceAction picks an action", () => {
    it("returns a create_lens action whose query parses", async () => {
      const { service, generateStructured } = compose();
      generateStructured.mockResolvedValueOnce({
        kind: "create_lens",
        name: "Errors",
        query: "status:error",
      });
      await expect(
        service.generateTraceAction({ projectId: "p1", prompt: "save errors", timeRange: RANGE }),
      ).resolves.toEqual({ ok: true, kind: "create_lens", name: "Errors", query: "status:error" });
      expect(generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 30_000, maxRetries: 1 }),
      );
    });

    it("retries with the parse failure in the system prompt", async () => {
      const { service, generateStructured } = compose();
      generateStructured
        .mockResolvedValueOnce({ kind: "apply_query", query: "" })
        .mockResolvedValueOnce({ kind: "apply_query", query: "status:error" });
      await service.generateTraceAction({ projectId: "p1", prompt: "x", timeRange: RANGE });
      const [, second] = generateStructured.mock.calls.map(([call]) => call);
      expect(JSON.stringify(second)).toContain("failed to parse: Empty query.");
    });

    it("raises the provider's curated fields, never its message, when every call throws", async () => {
      const { service, generateStructured } = compose();
      const failure = Object.assign(new Error("Incorrect API key provided: sk-proj-secret"), {
        statusCode: 401,
      });
      generateStructured.mockRejectedValue(failure);
      const error = await service
        .generateTraceAction({ projectId: "p1", prompt: "x", timeRange: RANGE })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AiQueryProviderError);
      expect(error).toMatchObject({ meta: { httpStatus: 401 } });
      expect(JSON.stringify(error)).not.toContain("sk-proj");
    });

    it("raises the validation reason when every query fails to parse", async () => {
      const { service, generateStructured } = compose();
      generateStructured.mockResolvedValue({ kind: "apply_query", query: "" });
      await expect(
        service.generateTraceAction({ projectId: "p1", prompt: "x", timeRange: RANGE }),
      ).rejects.toMatchObject({ meta: { reason: "Empty query.", lastQuery: "" } });
    });
  });

  describe("when generateInstantEvalQuestion writes a judge question", () => {
    it("returns the question with its criteria", async () => {
      const { service, generateStructured } = compose();
      generateStructured.mockResolvedValueOnce({
        kind: "question",
        instructions: "Is the user annoyed?",
        yes: "complains",
        no: "neutral",
      });
      await expect(
        service.generateInstantEvalQuestion({
          projectId: "p1",
          text: "annoyed users",
          target: "traces",
          known: KNOWN,
        }),
      ).resolves.toEqual({
        kind: "question",
        instructions: "Is the user annoyed?",
        criteria: ["complains", "neutral"],
      });
    });
  });

  describe("when generateSearchRoute routes without the classifier", () => {
    const routeInput = {
      projectId: "p1",
      text: "why did errors spike",
      timeRange: RANGE,
      target: "traces" as const,
      known: KNOWN,
      isLangyAvailable: false,
      isInstantEvalAvailable: false,
    };

    it("falls back to free text when the model picks a closed route", async () => {
      const { service, generateStructured } = compose();
      generateStructured.mockResolvedValueOnce({ route: "langy" });
      await expect(service.generateSearchRoute(routeInput)).resolves.toEqual({
        route: "free_text",
      });
    });

    it("returns a filter once its query parses", async () => {
      const { service, generateStructured } = compose();
      generateStructured
        .mockResolvedValueOnce({ route: "filter", query: "" })
        .mockResolvedValueOnce({ route: "filter", query: "status:error" });
      await expect(service.generateSearchRoute(routeInput)).resolves.toEqual({
        route: "filter",
        query: "status:error",
      });
    });
  });
});
