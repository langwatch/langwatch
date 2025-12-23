import { describe, it, expect } from "vitest";
import {
  applyFilters,
  applyFilterRule,
  applyPreset,
  matchesCriteria,
  valueMatches,
  isVercelAiSpan,
  isHttpRequestSpan,
  type TraceFilter,
  type Criteria,
  type Match,
} from "../trace-filters";
import { type ReadableSpan } from "@opentelemetry/sdk-trace-base";

function createMockSpan(name: string, scopeName: string): ReadableSpan {
  return {
    name,
    instrumentationScope: { name: scopeName, version: "1.0.0", schemaUrl: "" },
    attributes: {},
    resource: { attributes: {} },
  } as ReadableSpan;
}

describe("trace-filters", () => {
  describe("valueMatches", () => {
    describe("equals matcher", () => {
      it("should match exact string (case-sensitive by default)", () => {
        const rule: Match = { equals: "test" };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("Test", rule)).toBe(false);
        expect(valueMatches("TEST", rule)).toBe(false);
      });

      it("should match case-insensitively when ignoreCase is true", () => {
        const rule: Match = { equals: "test", ignoreCase: true };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("Test", rule)).toBe(true);
        expect(valueMatches("TEST", rule)).toBe(true);
        expect(valueMatches("TeSt", rule)).toBe(true);
      });

      it("should not match different strings", () => {
        const rule: Match = { equals: "test" };
        expect(valueMatches("testing", rule)).toBe(false);
        expect(valueMatches("tes", rule)).toBe(false);
        expect(valueMatches("", rule)).toBe(false);
      });

      it("should handle empty strings", () => {
        const rule: Match = { equals: "" };
        expect(valueMatches("", rule)).toBe(true);
        expect(valueMatches("test", rule)).toBe(false);
      });
    });

    describe("startsWith matcher", () => {
      it("should match prefix (case-sensitive by default)", () => {
        const rule: Match = { startsWith: "test" };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("testing", rule)).toBe(true);
        expect(valueMatches("test123", rule)).toBe(true);
        expect(valueMatches("Test", rule)).toBe(false);
        expect(valueMatches("Testing", rule)).toBe(false);
      });

      it("should match prefix case-insensitively when ignoreCase is true", () => {
        const rule: Match = { startsWith: "test", ignoreCase: true };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("Test", rule)).toBe(true);
        expect(valueMatches("Testing", rule)).toBe(true);
        expect(valueMatches("TEST123", rule)).toBe(true);
      });

      it("should not match when string doesn't start with prefix", () => {
        const rule: Match = { startsWith: "test" };
        expect(valueMatches("atest", rule)).toBe(false);
        expect(valueMatches("my test", rule)).toBe(false);
        expect(valueMatches("", rule)).toBe(false);
      });

      it("should handle empty prefix", () => {
        const rule: Match = { startsWith: "" };
        expect(valueMatches("", rule)).toBe(true);
        expect(valueMatches("anything", rule)).toBe(true);
      });
    });

    describe("regex matcher", () => {
      it("should match regex pattern", () => {
        const rule: Match = { matches: /^(GET|POST)\s/ };
        expect(valueMatches("GET /api", rule)).toBe(true);
        expect(valueMatches("POST /users", rule)).toBe(true);
        expect(valueMatches("PUT /resource", rule)).toBe(false);
        expect(valueMatches("get /api", rule)).toBe(false);
      });

      it("should apply ignoreCase to regex without i flag", () => {
        const rule: Match = { matches: /^(GET|POST)\s/, ignoreCase: true };
        expect(valueMatches("GET /api", rule)).toBe(true);
        expect(valueMatches("get /api", rule)).toBe(true);
        expect(valueMatches("GeT /api", rule)).toBe(true);
        expect(valueMatches("post /users", rule)).toBe(true);
      });

      it("should respect existing i flag in regex", () => {
        const rule: Match = { matches: /^(GET|POST)\s/i };
        expect(valueMatches("GET /api", rule)).toBe(true);
        expect(valueMatches("get /api", rule)).toBe(true);
        expect(valueMatches("GeT /api", rule)).toBe(true);
      });

      it("should not duplicate i flag when already present", () => {
        const rule: Match = { matches: /^test/i, ignoreCase: true };
        expect(valueMatches("TEST", rule)).toBe(true);
        expect(valueMatches("test", rule)).toBe(true);
      });

      it("should handle complex regex patterns", () => {
        const rule: Match = { matches: /\d{3}-\d{4}/ };
        expect(valueMatches("Call 555-1234 now", rule)).toBe(true);
        expect(valueMatches("No phone number", rule)).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle null/undefined values as empty strings", () => {
        const rule: Match = { equals: "" };
        expect(valueMatches(null as any, rule)).toBe(true);
        expect(valueMatches(undefined as any, rule)).toBe(true);
      });

      it("should return false when no matcher is specified", () => {
        const rule: Match = {};
        expect(valueMatches("anything", rule)).toBe(false);
      });

      it("should prioritize equals over startsWith when both present", () => {
        const rule: Match = { equals: "test", startsWith: "te" };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("testing", rule)).toBe(false);
      });

      it("should prioritize equals over matches when both present", () => {
        const rule: Match = { equals: "test", matches: /.*/ };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("anything", rule)).toBe(false);
      });
    });
  });

  describe("matchesCriteria", () => {
    it("should match when instrumentationScopeName criteria is met", () => {
      const span = createMockSpan("operation", "ai");
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "ai" }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("should not match when instrumentationScopeName criteria is not met", () => {
      const span = createMockSpan("operation", "http");
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "ai" }],
      };
      expect(matchesCriteria(span, criteria)).toBe(false);
    });

    it("should match when name criteria is met", () => {
      const span = createMockSpan("chat.completion", "ai");
      const criteria: Criteria = {
        name: [{ startsWith: "chat." }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("should not match when name criteria is not met", () => {
      const span = createMockSpan("llm.completion", "ai");
      const criteria: Criteria = {
        name: [{ startsWith: "chat." }],
      };
      expect(matchesCriteria(span, criteria)).toBe(false);
    });

    it("should match when both criteria are met (AND semantics)", () => {
      const span = createMockSpan("chat.completion", "ai");
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "ai" }],
        name: [{ startsWith: "chat." }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("should not match when only one criteria is met", () => {
      const span = createMockSpan("llm.completion", "ai");
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "ai" }],
        name: [{ startsWith: "chat." }],
      };
      expect(matchesCriteria(span, criteria)).toBe(false);
    });

    it("should use OR semantics for multiple matchers in same field", () => {
      const span1 = createMockSpan("chat.completion", "ai");
      const span2 = createMockSpan("llm.completion", "ai");
      const criteria: Criteria = {
        name: [{ startsWith: "chat." }, { startsWith: "llm." }],
      };
      expect(matchesCriteria(span1, criteria)).toBe(true);
      expect(matchesCriteria(span2, criteria)).toBe(true);
    });

    it("should handle empty criteria (match all)", () => {
      const span = createMockSpan("anything", "any-scope");
      const criteria: Criteria = {};
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("should handle missing instrumentationScope", () => {
      const span = { name: "operation", instrumentationScope: undefined } as any;
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "" }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("should handle missing span name", () => {
      const span = createMockSpan("", "ai");
      const criteria: Criteria = {
        name: [{ equals: "" }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });
  });

  describe("isVercelAiSpan", () => {
    it("should return true for ai scope (case-insensitive)", () => {
      expect(isVercelAiSpan(createMockSpan("op", "ai"))).toBe(true);
      expect(isVercelAiSpan(createMockSpan("op", "AI"))).toBe(true);
      expect(isVercelAiSpan(createMockSpan("op", "Ai"))).toBe(true);
    });

    it("should return false for non-ai scopes", () => {
      expect(isVercelAiSpan(createMockSpan("op", "http"))).toBe(false);
      expect(isVercelAiSpan(createMockSpan("op", "custom"))).toBe(false);
      expect(isVercelAiSpan(createMockSpan("op", "ai-sdk"))).toBe(false);
      expect(isVercelAiSpan(createMockSpan("op", ""))).toBe(false);
    });

    it("should handle missing instrumentation scope", () => {
      const span = { name: "op", instrumentationScope: undefined } as any;
      expect(isVercelAiSpan(span)).toBe(false);
    });
  });

  describe("isHttpRequestSpan", () => {
    it("should return true for HTTP verb patterns", () => {
      expect(isHttpRequestSpan(createMockSpan("GET /api/users", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("POST /data", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("PUT /resource/123", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("DELETE /item", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("PATCH /update", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("OPTIONS /", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("HEAD /check", "http"))).toBe(true);
    });

    it("should be case-insensitive for HTTP verbs", () => {
      expect(isHttpRequestSpan(createMockSpan("get /api", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("Get /api", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("GeT /api", "http"))).toBe(true);
    });

    it("should return false for non-HTTP patterns", () => {
      expect(isHttpRequestSpan(createMockSpan("chat.completion", "ai"))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan("database query", "db"))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan("GETAWAY", "custom"))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan("", ""))).toBe(false);
    });

    it("should require word boundary after verb", () => {
      expect(isHttpRequestSpan(createMockSpan("GET /api", "http"))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan("GETAWAY", "http"))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan("GETTING", "http"))).toBe(false);
    });
  });

  describe("applyPreset", () => {
    const spans = [
      createMockSpan("GET /users", "http"),
      createMockSpan("chat.completion", "ai"),
      createMockSpan("custom.operation", "custom"),
      createMockSpan("POST /data", "http"),
    ];

    it("should apply vercelAIOnly preset", () => {
      const result = applyPreset("vercelAIOnly", spans);
      expect(result).toHaveLength(1);
      expect(result[0]?.instrumentationScope?.name).toBe("ai");
    });

    it("should apply excludeHttpRequests preset", () => {
      const result = applyPreset("excludeHttpRequests", spans);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toEqual(["chat.completion", "custom.operation"]);
    });
  });

  describe("applyFilterRule", () => {
    const spans = [
      createMockSpan("GET /users", "http"),
      createMockSpan("chat.completion", "ai"),
      createMockSpan("llm.generate", "ai"),
      createMockSpan("custom.operation", "custom"),
    ];

    it("should apply preset rule", () => {
      const rule: TraceFilter = { preset: "vercelAIOnly" };
      const result = applyFilterRule(rule, spans);
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.instrumentationScope.name === "ai")).toBe(true);
    });

    it("should apply include rule", () => {
      const rule: TraceFilter = {
        include: { instrumentationScopeName: [{ equals: "ai" }] },
      };
      const result = applyFilterRule(rule, spans);
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.instrumentationScope.name === "ai")).toBe(true);
    });

    it("should apply exclude rule", () => {
      const rule: TraceFilter = {
        exclude: { instrumentationScopeName: [{ equals: "http" }] },
      };
      const result = applyFilterRule(rule, spans);
      expect(result).toHaveLength(3);
      expect(result.every((s) => s.instrumentationScope.name !== "http")).toBe(true);
    });

    it("should return all spans when rule has no matching condition", () => {
      const rule: TraceFilter = {} as any;
      const result = applyFilterRule(rule, spans);
      expect(result).toEqual(spans);
    });
  });

  describe("applyFilters", () => {
    const spans = [
      createMockSpan("GET /users", "http"),
      createMockSpan("chat.completion", "ai"),
      createMockSpan("llm.generate", "ai"),
      createMockSpan("custom.operation", "custom"),
    ];

    it("should return all spans when filters is undefined", () => {
      const result = applyFilters(undefined, spans);
      expect(result).toEqual(spans);
    });

    it("should return all spans when filters is empty array", () => {
      const result = applyFilters([], spans);
      expect(result).toEqual(spans);
    });

    it("should apply single filter", () => {
      const filters: TraceFilter[] = [{ preset: "vercelAIOnly" }];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.instrumentationScope.name === "ai")).toBe(true);
    });

    it("should apply multiple filters sequentially (AND semantics)", () => {
      const filters: TraceFilter[] = [
        { include: { instrumentationScopeName: [{ equals: "ai" }] } },
        { include: { name: [{ startsWith: "chat." }] } },
      ];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("chat.completion");
    });

    it("should narrow down results with each filter in pipeline", () => {
      const filters: TraceFilter[] = [
        { preset: "vercelAIOnly" }, // Keeps 2 AI spans
        { exclude: { name: [{ startsWith: "llm." }] } }, // Removes 1 span
      ];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("chat.completion");
    });

    it("should handle complex filter pipelines", () => {
      const filters: TraceFilter[] = [
        { exclude: { instrumentationScopeName: [{ equals: "http" }] } }, // Remove HTTP spans
        { include: { instrumentationScopeName: [{ equals: "ai" }] } }, // Keep only AI spans
        { exclude: { name: [{ equals: "llm.generate" }] } }, // Remove specific span
      ];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("chat.completion");
    });

    it("should return empty array when all spans are filtered out", () => {
      const filters: TraceFilter[] = [
        { include: { instrumentationScopeName: [{ equals: "nonexistent" }] } },
      ];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(0);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complex real-world scenario", () => {
      const spans = [
        createMockSpan("GET /health", "http"),
        createMockSpan("POST /api/data", "http"),
        createMockSpan("ai.chat.completions.create", "ai"),
        createMockSpan("ai.embeddings.create", "ai"),
        createMockSpan("database.query", "prisma"),
        createMockSpan("redis.get", "redis"),
        createMockSpan("custom.business.logic", "app"),
      ];

      const filters: TraceFilter[] = [
        { preset: "excludeHttpRequests" },
        { include: { instrumentationScopeName: [{ equals: "ai" }, { equals: "app" }] } },
        { exclude: { name: [{ matches: /embeddings/ }] } },
      ];

      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toEqual([
        "ai.chat.completions.create",
        "custom.business.logic",
      ]);
    });

    it("should handle case sensitivity properly across filters", () => {
      const spans = [
        createMockSpan("ChatCompletion", "AI"),
        createMockSpan("chat.completion", "ai"),
        createMockSpan("CHAT.COMPLETION", "Ai"),
      ];

      const filters: TraceFilter[] = [
        { include: { name: [{ equals: "chat.completion", ignoreCase: true }] } },
      ];

      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name).sort()).toEqual([
        "CHAT.COMPLETION",
        "chat.completion",
      ]);
    });
  });
});

