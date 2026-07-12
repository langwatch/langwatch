import { describe, expect, it } from "vitest";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import { deriveSessionBanner } from "../sessionBanner";

function modelSpan(model: string, atMs: number): SpanDetail {
  return {
    spanId: `llm-${atMs}`,
    name: "claude_code.llm_request",
    startTimeMs: atMs,
    params: { "gen_ai.request.model": model },
  } as unknown as SpanDetail;
}

describe("deriveSessionBanner", () => {
  describe("given resource attributes and model-call spans", () => {
    it("reads the version and repo off the resource, and the model off the last call", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: {
          "service.version": "2.1.207",
          "project.repo": "langwatch/langwatch",
        },
        spans: [modelSpan("claude-opus-4-8", 1_000), modelSpan("claude-sonnet-5", 2_000)],
      });

      expect(banner).toEqual({
        version: "2.1.207",
        model: "claude-sonnet-5",
        repo: "langwatch/langwatch",
      });
    });
  });

  describe("given no model-call spans", () => {
    it("reports the model as unknown rather than guessing", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.version": "2.1.207" },
        spans: [],
      });

      expect(banner.model).toBeNull();
    });
  });
});
