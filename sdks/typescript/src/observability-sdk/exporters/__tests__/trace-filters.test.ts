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

function createMockSpan({ name, scopeName }: { name: string; scopeName: string }): ReadableSpan {
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
      it("matches exact string (case-sensitive by default)", () => {
        const rule: Match = { equals: "test" };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("Test", rule)).toBe(false);
        expect(valueMatches("TEST", rule)).toBe(false);
      });

      it("matches case-insensitively when ignoreCase is true", () => {
        const rule: Match = { equals: "test", ignoreCase: true };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("Test", rule)).toBe(true);
        expect(valueMatches("TEST", rule)).toBe(true);
        expect(valueMatches("TeSt", rule)).toBe(true);
      });

      it("does not match different strings", () => {
        const rule: Match = { equals: "test" };
        expect(valueMatches("testing", rule)).toBe(false);
        expect(valueMatches("tes", rule)).toBe(false);
        expect(valueMatches("", rule)).toBe(false);
      });

      it("handles empty strings", () => {
        const rule: Match = { equals: "" };
        expect(valueMatches("", rule)).toBe(true);
        expect(valueMatches("test", rule)).toBe(false);
      });
    });

    describe("startsWith matcher", () => {
      it("matches prefix (case-sensitive by default)", () => {
        const rule: Match = { startsWith: "test" };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("testing", rule)).toBe(true);
        expect(valueMatches("test123", rule)).toBe(true);
        expect(valueMatches("Test", rule)).toBe(false);
        expect(valueMatches("Testing", rule)).toBe(false);
      });

      it("matches prefix case-insensitively when ignoreCase is true", () => {
        const rule: Match = { startsWith: "test", ignoreCase: true };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("Test", rule)).toBe(true);
        expect(valueMatches("Testing", rule)).toBe(true);
        expect(valueMatches("TEST123", rule)).toBe(true);
      });

      it("does not match when string doesn't start with prefix", () => {
        const rule: Match = { startsWith: "test" };
        expect(valueMatches("atest", rule)).toBe(false);
        expect(valueMatches("my test", rule)).toBe(false);
        expect(valueMatches("", rule)).toBe(false);
      });

      it("handles empty prefix", () => {
        const rule: Match = { startsWith: "" };
        expect(valueMatches("", rule)).toBe(true);
        expect(valueMatches("anything", rule)).toBe(true);
      });
    });

    describe("regex matcher", () => {
      it("matches regex pattern", () => {
        const rule: Match = { matches: /^(GET|POST)\s/ };
        expect(valueMatches("GET /api", rule)).toBe(true);
        expect(valueMatches("POST /users", rule)).toBe(true);
        expect(valueMatches("PUT /resource", rule)).toBe(false);
        expect(valueMatches("get /api", rule)).toBe(false);
      });

      it("applies ignoreCase to regex without i flag", () => {
        const rule: Match = { matches: /^(GET|POST)\s/, ignoreCase: true };
        expect(valueMatches("GET /api", rule)).toBe(true);
        expect(valueMatches("get /api", rule)).toBe(true);
        expect(valueMatches("GeT /api", rule)).toBe(true);
        expect(valueMatches("post /users", rule)).toBe(true);
      });

      it("respects existing i flag in regex", () => {
        const rule: Match = { matches: /^(GET|POST)\s/i };
        expect(valueMatches("GET /api", rule)).toBe(true);
        expect(valueMatches("get /api", rule)).toBe(true);
        expect(valueMatches("GeT /api", rule)).toBe(true);
      });

      it("does not duplicate i flag when already present", () => {
        const rule: Match = { matches: /^test/i, ignoreCase: true };
        expect(valueMatches("TEST", rule)).toBe(true);
        expect(valueMatches("test", rule)).toBe(true);
      });

      it("handles complex regex patterns", () => {
        const rule: Match = { matches: /\d{3}-\d{4}/ };
        expect(valueMatches("Call 555-1234 now", rule)).toBe(true);
        expect(valueMatches("No phone number", rule)).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("handles null/undefined values as empty strings", () => {
        const rule: Match = { equals: "" };
        expect(valueMatches(null as any, rule)).toBe(true);
        expect(valueMatches(undefined as any, rule)).toBe(true);
      });

      it("returns false when no matcher is specified", () => {
        const rule: Match = {};
        expect(valueMatches("anything", rule)).toBe(false);
      });

      it("prioritizes equals over startsWith when both present", () => {
        const rule: Match = { equals: "test", startsWith: "te" };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("testing", rule)).toBe(false);
      });

      it("prioritizes equals over matches when both present", () => {
        const rule: Match = { equals: "test", matches: /.*/ };
        expect(valueMatches("test", rule)).toBe(true);
        expect(valueMatches("anything", rule)).toBe(false);
      });
    });
  });

  describe("matchesCriteria", () => {
    it("matches when instrumentationScopeName criteria is met", () => {
      const span = createMockSpan({ name: "operation", scopeName: "ai" });
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "ai" }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("does not match when instrumentationScopeName criteria is not met", () => {
      const span = createMockSpan({ name: "operation", scopeName: "http" });
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "ai" }],
      };
      expect(matchesCriteria(span, criteria)).toBe(false);
    });

    it("matches when name criteria is met", () => {
      const span = createMockSpan({ name: "chat.completion", scopeName: "ai" });
      const criteria: Criteria = {
        name: [{ startsWith: "chat." }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("does not match when name criteria is not met", () => {
      const span = createMockSpan({ name: "llm.completion", scopeName: "ai" });
      const criteria: Criteria = {
        name: [{ startsWith: "chat." }],
      };
      expect(matchesCriteria(span, criteria)).toBe(false);
    });

    it("matches when both criteria are met (AND semantics)", () => {
      const span = createMockSpan({ name: "chat.completion", scopeName: "ai" });
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "ai" }],
        name: [{ startsWith: "chat." }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("does not match when only one criteria is met", () => {
      const span = createMockSpan({ name: "llm.completion", scopeName: "ai" });
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "ai" }],
        name: [{ startsWith: "chat." }],
      };
      expect(matchesCriteria(span, criteria)).toBe(false);
    });

    it("uses OR semantics for multiple matchers in same field", () => {
      const span1 = createMockSpan({ name: "chat.completion", scopeName: "ai" });
      const span2 = createMockSpan({ name: "llm.completion", scopeName: "ai" });
      const criteria: Criteria = {
        name: [{ startsWith: "chat." }, { startsWith: "llm." }],
      };
      expect(matchesCriteria(span1, criteria)).toBe(true);
      expect(matchesCriteria(span2, criteria)).toBe(true);
    });

    it("handles empty criteria (match all)", () => {
      const span = createMockSpan({ name: "anything", scopeName: "any-scope" });
      const criteria: Criteria = {};
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("handles missing instrumentationScope", () => {
      const span = { name: "operation", instrumentationScope: undefined } as any;
      const criteria: Criteria = {
        instrumentationScopeName: [{ equals: "" }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });

    it("handles missing span name", () => {
      const span = createMockSpan({ name: "", scopeName: "ai" });
      const criteria: Criteria = {
        name: [{ equals: "" }],
      };
      expect(matchesCriteria(span, criteria)).toBe(true);
    });
  });

  describe("isVercelAiSpan", () => {
    it("returns true for ai scope (case-insensitive)", () => {
      expect(isVercelAiSpan(createMockSpan({ name: "op", scopeName: "ai" }))).toBe(true);
      expect(isVercelAiSpan(createMockSpan({ name: "op", scopeName: "AI" }))).toBe(true);
      expect(isVercelAiSpan(createMockSpan({ name: "op", scopeName: "Ai" }))).toBe(true);
    });

    it("returns false for non-ai scopes", () => {
      expect(isVercelAiSpan(createMockSpan({ name: "op", scopeName: "http" }))).toBe(false);
      expect(isVercelAiSpan(createMockSpan({ name: "op", scopeName: "custom" }))).toBe(false);
      expect(isVercelAiSpan(createMockSpan({ name: "op", scopeName: "ai-sdk" }))).toBe(false);
      expect(isVercelAiSpan(createMockSpan({ name: "op", scopeName: "" }))).toBe(false);
    });

    it("handles missing instrumentation scope", () => {
      const span = { name: "op", instrumentationScope: undefined } as any;
      expect(isVercelAiSpan(span)).toBe(false);
    });
  });

  describe("isHttpRequestSpan", () => {
    it("returns true for HTTP verb patterns", () => {
      expect(isHttpRequestSpan(createMockSpan({ name: "GET /api/users", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "POST /data", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "PUT /resource/123", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "DELETE /item", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "PATCH /update", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "OPTIONS /", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "HEAD /check", scopeName: "http" }))).toBe(true);
    });

    it("is case-insensitive for HTTP verbs", () => {
      expect(isHttpRequestSpan(createMockSpan({ name: "get /api", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "Get /api", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "GeT /api", scopeName: "http" }))).toBe(true);
    });

    it("returns false for non-HTTP patterns", () => {
      expect(isHttpRequestSpan(createMockSpan({ name: "chat.completion", scopeName: "ai" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "database query", scopeName: "db" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "GETAWAY", scopeName: "custom" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "", scopeName: "" }))).toBe(false);
    });

    it("requires word boundary after verb", () => {
      expect(isHttpRequestSpan(createMockSpan({ name: "GET /api", scopeName: "http" }))).toBe(true);
      expect(isHttpRequestSpan(createMockSpan({ name: "GETAWAY", scopeName: "http" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "GETTING", scopeName: "http" }))).toBe(false);
    });

    it("requires whitespace or end-of-string after the verb, not any word boundary", () => {
      // Hyphen, dot, slash etc. are word boundaries but not OTel HTTP span shapes.
      expect(isHttpRequestSpan(createMockSpan({ name: "post-process", scopeName: "custom" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "get-user-profile", scopeName: "custom" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "delete-account", scopeName: "custom" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "patch-config", scopeName: "custom" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "head-request-handler", scopeName: "custom" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "options-resolver", scopeName: "custom" }))).toBe(false);
      expect(isHttpRequestSpan(createMockSpan({ name: "put-record.v2", scopeName: "custom" }))).toBe(false);
      // Bare verb at end-of-string is still a valid OTel shape.
      expect(isHttpRequestSpan(createMockSpan({ name: "POST", scopeName: "http" }))).toBe(true);
    });
  });

  describe("applyPreset", () => {
    const spans = [
      createMockSpan({ name: "GET /users", scopeName: "http" }),
      createMockSpan({ name: "chat.completion", scopeName: "ai" }),
      createMockSpan({ name: "custom.operation", scopeName: "custom" }),
      createMockSpan({ name: "POST /data", scopeName: "http" }),
    ];

    it("applies vercelAIOnly preset", () => {
      const result = applyPreset("vercelAIOnly", spans);
      expect(result).toHaveLength(1);
      expect(result[0]?.instrumentationScope?.name).toBe("ai");
    });

    it("applies excludeHttpRequests preset", () => {
      const result = applyPreset("excludeHttpRequests", spans);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toEqual(["chat.completion", "custom.operation"]);
    });
  });

  describe("applyFilterRule", () => {
    const spans = [
      createMockSpan({ name: "GET /users", scopeName: "http" }),
      createMockSpan({ name: "chat.completion", scopeName: "ai" }),
      createMockSpan({ name: "llm.generate", scopeName: "ai" }),
      createMockSpan({ name: "custom.operation", scopeName: "custom" }),
    ];

    it("applies preset rule", () => {
      const rule: TraceFilter = { preset: "vercelAIOnly" };
      const result = applyFilterRule(rule, spans);
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.instrumentationScope.name === "ai")).toBe(true);
    });

    it("applies include rule", () => {
      const rule: TraceFilter = {
        include: { instrumentationScopeName: [{ equals: "ai" }] },
      };
      const result = applyFilterRule(rule, spans);
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.instrumentationScope.name === "ai")).toBe(true);
    });

    it("applies exclude rule", () => {
      const rule: TraceFilter = {
        exclude: { instrumentationScopeName: [{ equals: "http" }] },
      };
      const result = applyFilterRule(rule, spans);
      expect(result).toHaveLength(3);
      expect(result.every((s) => s.instrumentationScope.name !== "http")).toBe(true);
    });

    it("returns all spans when rule has no matching condition", () => {
      const rule: TraceFilter = {} as any;
      const result = applyFilterRule(rule, spans);
      expect(result).toEqual(spans);
    });
  });

  describe("applyFilters", () => {
    const spans = [
      createMockSpan({ name: "GET /users", scopeName: "http" }),
      createMockSpan({ name: "chat.completion", scopeName: "ai" }),
      createMockSpan({ name: "llm.generate", scopeName: "ai" }),
      createMockSpan({ name: "custom.operation", scopeName: "custom" }),
    ];

    it("returns all spans when filters is undefined", () => {
      const result = applyFilters(undefined, spans);
      expect(result).toEqual(spans);
    });

    it("returns all spans when filters is empty array", () => {
      const result = applyFilters([], spans);
      expect(result).toEqual(spans);
    });

    it("applies single filter", () => {
      const filters: TraceFilter[] = [{ preset: "vercelAIOnly" }];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.instrumentationScope.name === "ai")).toBe(true);
    });

    it("applies multiple filters sequentially (AND semantics)", () => {
      const filters: TraceFilter[] = [
        { include: { instrumentationScopeName: [{ equals: "ai" }] } },
        { include: { name: [{ startsWith: "chat." }] } },
      ];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("chat.completion");
    });

    it("narrows down results with each filter in pipeline", () => {
      const filters: TraceFilter[] = [
        { preset: "vercelAIOnly" }, // Keeps 2 AI spans
        { exclude: { name: [{ startsWith: "llm." }] } }, // Removes 1 span
      ];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("chat.completion");
    });

    it("handles complex filter pipelines", () => {
      const filters: TraceFilter[] = [
        { exclude: { instrumentationScopeName: [{ equals: "http" }] } }, // Remove HTTP spans
        { include: { instrumentationScopeName: [{ equals: "ai" }] } }, // Keep only AI spans
        { exclude: { name: [{ equals: "llm.generate" }] } }, // Remove specific span
      ];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("chat.completion");
    });

    it("returns empty array when all spans are filtered out", () => {
      const filters: TraceFilter[] = [
        { include: { instrumentationScopeName: [{ equals: "nonexistent" }] } },
      ];
      const result = applyFilters(filters, spans);
      expect(result).toHaveLength(0);
    });
  });

  describe("integration scenarios", () => {
    it("handles complex real-world scenario", () => {
      const spans = [
        createMockSpan({ name: "GET /health", scopeName: "http" }),
        createMockSpan({ name: "POST /api/data", scopeName: "http" }),
        createMockSpan({ name: "ai.chat.completions.create", scopeName: "ai" }),
        createMockSpan({ name: "ai.embeddings.create", scopeName: "ai" }),
        createMockSpan({ name: "database.query", scopeName: "prisma" }),
        createMockSpan({ name: "redis.get", scopeName: "redis" }),
        createMockSpan({ name: "custom.business.logic", scopeName: "app" }),
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

    it("handles case sensitivity properly across filters", () => {
      const spans = [
        createMockSpan({ name: "ChatCompletion", scopeName: "AI" }),
        createMockSpan({ name: "chat.completion", scopeName: "ai" }),
        createMockSpan({ name: "CHAT.COMPLETION", scopeName: "Ai" }),
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
