/**
 * @vitest-environment node
 *
 * Model cost rule preview + unmapped-cost suggestion, against a real
 * ClickHouse (span storage) and real Postgres (custom cost rules). No mocks —
 * the whole point of the preview is parity with the production matching
 * pipeline, so the tests drive the same repository, service, and matching
 * functions production uses.
 *
 * Specs:
 *   specs/model-providers/model-cost-matching-spans-preview.feature
 *   specs/traces-v2/span-unmapped-cost-suggestion.feature
 *   specs/model-providers/model-cost-scoping.feature (ingestion enrichment
 *     resolves org/team-scoped rules through the scope cascade)
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { ValidationError } from "../../domain-error";
import {
  deriveUnmappedCostSuggestion,
  previewCostRuleMatchingSpans,
} from "../model-cost-span-preview.service";
import { SpanStorageClickHouseRepository } from "../repositories/span-storage.clickhouse.repository";
import { createCostEnrichmentDeps } from "../span-cost-enrichment.service";
import { SpanStorageService } from "../span-storage.service";

const ns = nanoid(8);
const tenantId = `test-cost-preview-${ns}`;
const otherTenantId = `test-cost-preview-other-${ns}`;
const nowMs = Date.now();
const recentMs = nowMs - 60 * 60 * 1000;
const beyondWindowMs = nowMs - 8 * 24 * 60 * 60 * 1000;

let ch: ClickHouseClient;
let spans: SpanStorageService;

function makeSpanRow({
  tenant,
  traceId,
  spanId,
  startMs,
  attributes,
  spanName = "llm call",
}: {
  tenant: string;
  traceId: string;
  spanId: string;
  startMs: number;
  attributes: Record<string, string>;
  spanName?: string;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(startMs),
    EndTime: new Date(startMs + 250),
    DurationMs: 250,
    SpanName: spanName,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: attributes,
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [] as Date[],
    "Events.Name": [] as string[],
    "Events.Attributes": [] as Record<string, string>[],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(startMs),
    UpdatedAt: new Date(startMs),
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  spans = new SpanStorageService(
    new SpanStorageClickHouseRepository(async () => ch),
  );

  await ch.insert({
    table: "stored_spans",
    values: [
      // Bedrock-prefixed model, canonical token keys.
      makeSpanRow({
        tenant: tenantId,
        traceId: `trace-bedrock-${ns}`,
        spanId: "span-bedrock",
        startMs: recentMs,
        spanName: "chat completion",
        attributes: {
          "gen_ai.request.model": "bedrock/eu.anthropic.claude-sonnet-4-6",
          "gen_ai.usage.input_tokens": "1000",
          "gen_ai.usage.output_tokens": "200",
        },
      }),
      // Bedrock raw inference-profile id, legacy token keys.
      makeSpanRow({
        tenant: tenantId,
        traceId: `trace-raw-bedrock-${ns}`,
        spanId: "span-raw-bedrock",
        startMs: recentMs - 1000,
        attributes: {
          "gen_ai.request.model": "eu.anthropic.claude-sonnet-4-6-v1:0",
          "gen_ai.usage.prompt_tokens": "500",
          "gen_ai.usage.completion_tokens": "50",
        },
      }),
      // Registry-priced model with no token usage recorded.
      makeSpanRow({
        tenant: tenantId,
        traceId: `trace-mini-${ns}`,
        spanId: "span-mini",
        startMs: recentMs - 2000,
        attributes: {
          "gen_ai.request.model": "gpt-5-mini",
        },
      }),
      // Response model must win over request model.
      makeSpanRow({
        tenant: tenantId,
        traceId: `trace-respmodel-${ns}`,
        spanId: "span-respmodel",
        startMs: recentMs - 3000,
        attributes: {
          "gen_ai.request.model": `request-model-${ns}`,
          "gen_ai.response.model": `response-model-${ns}`,
        },
      }),
      // Outside the preview window — must never appear.
      makeSpanRow({
        tenant: tenantId,
        traceId: `trace-old-${ns}`,
        spanId: "span-old",
        startMs: beyondWindowMs,
        attributes: {
          "gen_ai.request.model": `stale-model-${ns}`,
          "gen_ai.usage.input_tokens": "10",
        },
      }),
      // Another tenant's span — must never leak into the preview.
      makeSpanRow({
        tenant: otherTenantId,
        traceId: `trace-foreign-${ns}`,
        spanId: "span-foreign",
        startMs: recentMs,
        attributes: {
          "gen_ai.request.model": "bedrock/eu.anthropic.claude-sonnet-4-6",
          "gen_ai.usage.input_tokens": "9999",
        },
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
});

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE stored_spans DELETE WHERE TenantId IN ({a:String}, {b:String})",
      query_params: { a: tenantId, b: otherTenantId },
    });
  }
  await stopTestContainers();
});

describe("previewCostRuleMatchingSpans", () => {
  describe("when the regex matches a recorded model exactly", () => {
    it("lists the matching model with sample spans, tokens, and an example cost", async () => {
      const preview = await previewCostRuleMatchingSpans(spans, {
        projectId: tenantId,
        regex: "^bedrock/eu\\.anthropic\\.claude-sonnet-4-6$",
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      });

      expect(preview.matchedModels).toHaveLength(1);
      expect(preview.matchedModels[0]!.model).toBe(
        "bedrock/eu.anthropic.claude-sonnet-4-6",
      );
      expect(preview.totalMatchedSpans).toBe(1);

      expect(preview.sampleSpans).toHaveLength(1);
      const sample = preview.sampleSpans[0]!;
      expect(sample.spanId).toBe("span-bedrock");
      expect(sample.traceId).toBe(`trace-bedrock-${ns}`);
      expect(sample.spanName).toBe("chat completion");
      expect(sample.inputTokens).toBe(1000);
      expect(sample.outputTokens).toBe(200);
      expect(sample.exampleCost).toBeCloseTo(
        1000 * 0.000003 + 200 * 0.000015,
        10,
      );

      const unmatched = preview.unmatchedModels.map((m) => m.model);
      expect(unmatched).toContain("eu.anthropic.claude-sonnet-4-6-v1:0");
      expect(unmatched).toContain("gpt-5-mini");
    });

    it("reads token counts from the legacy prompt/completion attribute aliases", async () => {
      const preview = await previewCostRuleMatchingSpans(spans, {
        projectId: tenantId,
        regex: "^eu\\.anthropic\\.claude-sonnet-4-6-v1:0$",
        inputCostPerToken: 0.000002,
        outputCostPerToken: 0.00001,
      });

      expect(preview.sampleSpans).toHaveLength(1);
      const sample = preview.sampleSpans[0]!;
      expect(sample.inputTokens).toBe(500);
      expect(sample.outputTokens).toBe(50);
    });

    it("returns no example cost when no rates were entered yet", async () => {
      const preview = await previewCostRuleMatchingSpans(spans, {
        projectId: tenantId,
        regex: "^bedrock/eu\\.anthropic\\.claude-sonnet-4-6$",
      });

      expect(preview.sampleSpans[0]!.exampleCost).toBeNull();
    });
  });

  describe("when the regex relies on the pipeline's matching fallbacks", () => {
    it("matches a raw Bedrock inference-profile id through Bedrock normalization", async () => {
      // `eu.anthropic.claude-sonnet-4-6-v1:0` normalizes to
      // `anthropic/claude-sonnet-4-6` before matching — same as ingestion.
      const preview = await previewCostRuleMatchingSpans(spans, {
        projectId: tenantId,
        regex: "anthropic/claude-sonnet-4-6",
      });

      const matched = preview.matchedModels.map((m) => m.model);
      expect(matched).toContain("eu.anthropic.claude-sonnet-4-6-v1:0");
    });
  });

  describe("when listing the project's recent models", () => {
    it("prefers the response model over the request model", async () => {
      const preview = await previewCostRuleMatchingSpans(spans, {
        projectId: tenantId,
        regex: `^response-model-${ns}$`,
      });

      expect(preview.matchedModels.map((m) => m.model)).toContain(
        `response-model-${ns}`,
      );
      expect(preview.unmatchedModels.map((m) => m.model)).not.toContain(
        `request-model-${ns}`,
      );
    });

    it("excludes spans outside the preview window", async () => {
      const preview = await previewCostRuleMatchingSpans(spans, {
        projectId: tenantId,
        regex: `^stale-model-${ns}$`,
      });

      expect(preview.matchedModels).toHaveLength(0);
      expect(preview.totalMatchedSpans).toBe(0);
    });

    it("never includes another tenant's spans", async () => {
      const preview = await previewCostRuleMatchingSpans(spans, {
        projectId: tenantId,
        regex: ".*",
      });

      const sampleSpanIds = preview.sampleSpans.map((s) => s.spanId);
      expect(sampleSpanIds).not.toContain("span-foreign");
      expect(preview.totalMatchedSpans).toBe(4);
    });

    it("ranks token-bearing spans ahead of token-less ones in the sample list", async () => {
      const preview = await previewCostRuleMatchingSpans(spans, {
        projectId: tenantId,
        regex: ".*",
      });

      const tokenless = preview.sampleSpans.findIndex(
        (s) => s.inputTokens === null && s.outputTokens === null,
      );
      const lastTokenBearing = preview.sampleSpans.reduce(
        (last, s, i) =>
          s.inputTokens !== null || s.outputTokens !== null ? i : last,
        -1,
      );
      expect(tokenless).toBeGreaterThan(lastTokenBearing);
    });
  });

  describe("when the regex is invalid or unsafe", () => {
    it("throws a validation error", async () => {
      await expect(
        previewCostRuleMatchingSpans(spans, {
          projectId: tenantId,
          regex: "(a+)+$",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});

describe("unmapped cost suggestion + scope-cascade rule resolution", () => {
  const orgId = `org-${ns}`;
  const teamId = `team-${ns}`;
  const projectId = `proj-${ns}`;
  const unmappedModel = `acme-internal-llm-${ns}`;
  const orgRuleModel = `acme-org-llm-${ns}`;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: orgId, slug: orgId },
    });
    await prisma.team.create({
      data: { id: teamId, name: teamId, slug: teamId, organizationId: orgId },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: projectId,
        slug: projectId,
        teamId,
        language: "en",
        framework: "openai",
        apiKey: `key-${projectId}`,
      },
    });
    // Organization-scoped rule (legacy projectId column stays null) — the
    // shape that used to be invisible to ingestion enrichment.
    await prisma.customLLMModelCost.create({
      data: {
        id: `llmcost_${nanoid()}`,
        organizationId: orgId,
        scopeType: "ORGANIZATION",
        scopeId: orgId,
        projectId: null,
        model: orgRuleModel,
        regex: `^${orgRuleModel}$`,
        inputCostPerToken: 0.000001,
        outputCostPerToken: 0.000002,
      },
    });
  });

  afterAll(async () => {
    await prisma.customLLMModelCost.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  describe("when a span has tokens and a model nothing prices", () => {
    it("suggests creating a cost mapping", async () => {
      const suggestion = await deriveUnmappedCostSuggestion({
        projectId,
        model: unmappedModel,
        cost: null,
        promptTokens: 1200,
        completionTokens: 80,
      });

      expect(suggestion).toEqual({ model: unmappedModel });
    });
  });

  describe("when the model is already priced", () => {
    it("returns null for a model covered by the static registry", async () => {
      const suggestion = await deriveUnmappedCostSuggestion({
        projectId,
        model: "gpt-5-mini",
        cost: null,
        promptTokens: 100,
        completionTokens: 10,
      });

      expect(suggestion).toBeNull();
    });

    it("returns null for a model covered by an organization-scoped custom rule", async () => {
      const suggestion = await deriveUnmappedCostSuggestion({
        projectId,
        model: orgRuleModel,
        cost: null,
        promptTokens: 100,
        completionTokens: 10,
      });

      expect(suggestion).toBeNull();
    });
  });

  describe("when the span carries no symptom", () => {
    it("returns null when a cost was already computed", async () => {
      const suggestion = await deriveUnmappedCostSuggestion({
        projectId,
        model: unmappedModel,
        cost: 0.01,
        promptTokens: 100,
        completionTokens: 10,
      });

      expect(suggestion).toBeNull();
    });

    it("returns null when the span has no token usage", async () => {
      const suggestion = await deriveUnmappedCostSuggestion({
        projectId,
        model: unmappedModel,
        cost: null,
        promptTokens: null,
        completionTokens: 0,
      });

      expect(suggestion).toBeNull();
    });
  });

  describe("when ingestion enrichment loads custom rules for a project", () => {
    it("resolves organization-scoped rules through the scope cascade", async () => {
      // Regression: enrichment used to filter customLLMModelCost by the
      // legacy projectId column, so ORGANIZATION/TEAM-scoped rules
      // (projectId = null) never applied at ingestion and spans stayed
      // uncosted despite a configured rule.
      const costs =
        await createCostEnrichmentDeps(prisma).getCustomModelCosts(projectId);

      expect(costs.map((c) => c.model)).toContain(orgRuleModel);
      const orgRule = costs.find((c) => c.model === orgRuleModel)!;
      expect(orgRule.inputCostPerToken).toBe(0.000001);
      expect(orgRule.scopeType).toBe("ORGANIZATION");
    });
  });
});
