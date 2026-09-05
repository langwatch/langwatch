/**
 * `previewCostRuleMatchingSpans` takes its span reader as a structural port (`ModelCostPreviewSpanReader`), so the matching
 * cascade and the tenant scoping it relies on are testable with a fake reader instead of a live ClickHouse-backed one.
 * Spec: specs/model-providers/model-cost-matching-spans-preview.feature
 */
import { describe, expect, it } from "vitest";
import {
  ModelCostPreviewService,
  type ModelCostPreviewSpanReader,
} from "../model-cost-preview.service";
import { ModelCostRegexSafetyService } from "../model-cost-regex-safety.service";

const service = ModelCostPreviewService.create({
  regexSafety: ModelCostRegexSafetyService.create(),
});

function fakeReader(overrides: {
  stats?: Array<{ model: string; spanCount: number; lastSeenMs: number }>;
  spans?: Array<{
    traceId: string;
    spanId: string;
    spanName: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheCreationTokens: number | null;
    cacheCreation1hTokens: number | null;
    startTimeMs: number;
  }>;
  tenantIdsSeen: string[];
}): ModelCostPreviewSpanReader {
  return {
    async getModelUsageStats(input) {
      overrides.tenantIdsSeen.push(input.tenantId);
      return overrides.stats ?? [];
    },
    async getRecentSpansByModels(input) {
      overrides.tenantIdsSeen.push(input.tenantId);
      return overrides.spans ?? [];
    },
  };
}

describe("ModelCostPreviewService.previewCostRuleMatchingSpans", () => {
  describe("when the regex relies on the pipeline's matching fallbacks", () => {
    /** @scenario "Matching follows the same fallbacks as cost computation" */
    it("matches a raw Bedrock inference-profile id through Bedrock normalization", async () => {
      const tenantIdsSeen: string[] = [];
      const spans = fakeReader({
        stats: [
          { model: "eu.anthropic.claude-sonnet-4-6-v1:0", spanCount: 3, lastSeenMs: Date.now() },
        ],
        tenantIdsSeen,
      });

      const preview = await service.previewCostRuleMatchingSpans({
        spans,
        input: { projectId: "project_1", regex: "anthropic/claude-sonnet-4-6" },
      });

      expect(preview.matchedModels.map((m) => m.model)).toContain(
        "eu.anthropic.claude-sonnet-4-6-v1:0",
      );
    });
  });

  describe("when the preview reads recently-seen models and their spans", () => {
    /** @scenario "Preview is scoped to the current project" */
    it("asks the reader for exactly the calling project's tenant id on every read", async () => {
      const tenantIdsSeen: string[] = [];
      const spans = fakeReader({
        stats: [{ model: "gpt-5-mini", spanCount: 2, lastSeenMs: Date.now() }],
        spans: [
          {
            traceId: "trace_1",
            spanId: "span_1",
            spanName: "llm",
            model: "gpt-5-mini",
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null,
            cacheCreation1hTokens: null,
            startTimeMs: Date.now(),
          },
        ],
        tenantIdsSeen,
      });

      await service.previewCostRuleMatchingSpans({
        spans,
        input: { projectId: "project_1", regex: "^gpt-5-mini$" },
      });

      // The reader is only ever asked for the calling project's own tenant id
      // — never for another project's, and never for none.
      expect(tenantIdsSeen.every((id) => id === "project_1")).toBe(true);
      expect(tenantIdsSeen.length).toBeGreaterThan(0);
    });
  });
});
