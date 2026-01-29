import { describe, it, expect } from "vitest";

/**
 * Tests for entity ID detection in command search.
 * These test the parsing logic without requiring API mocking.
 */
describe("useCommandSearch ID detection", () => {
  // Entity ID prefixes
  const ENTITY_PREFIXES = [
    "agent_",
    "dataset_",
    "evaluator_",
    "experiment_",
    "prompt_",
    "workflow_",
    "scen_",
    "monitor_",
  ];

  // Regex patterns
  const OTEL_TRACE_ID_REGEX = /^[0-9a-f]{32}$/i;
  const OTEL_SPAN_ID_REGEX = /^[0-9a-f]{16}$/i;
  const TRACE_PREFIX_REGEX = /^trace_/i;
  const SPAN_PREFIX_REGEX = /^span_/i;

  function detectIdType(
    query: string
  ): "entity" | "trace" | "span" | null {
    const trimmed = query.trim();
    if (!trimmed) return null;

    // Check KSUID prefixes
    for (const prefix of ENTITY_PREFIXES) {
      if (trimmed.startsWith(prefix)) return "entity";
    }

    // Check trace patterns
    if (TRACE_PREFIX_REGEX.test(trimmed) || OTEL_TRACE_ID_REGEX.test(trimmed)) {
      return "trace";
    }

    // Check span patterns
    if (SPAN_PREFIX_REGEX.test(trimmed) || OTEL_SPAN_ID_REGEX.test(trimmed)) {
      return "span";
    }

    return null;
  }

  describe("entity ID detection", () => {
    it.each([
      ["agent_abc123", "entity"],
      ["dataset_xyz789", "entity"],
      ["evaluator_test", "entity"],
      ["experiment_exp1", "entity"],
      ["prompt_p1", "entity"],
      ["workflow_w1", "entity"],
      ["scen_s1", "entity"],
      ["monitor_m1", "entity"],
    ])("detects %s as %s", (input, expected) => {
      expect(detectIdType(input)).toBe(expected);
    });
  });

  describe("trace ID detection", () => {
    it("detects trace_ prefix", () => {
      expect(detectIdType("trace_abc123xyz")).toBe("trace");
    });

    it("detects OTEL 128-bit trace ID", () => {
      expect(detectIdType("0123456789abcdef0123456789abcdef")).toBe("trace");
    });

    it("is case insensitive for OTEL format", () => {
      expect(detectIdType("0123456789ABCDEF0123456789ABCDEF")).toBe("trace");
    });
  });

  describe("span ID detection", () => {
    it("detects span_ prefix", () => {
      expect(detectIdType("span_abc123xyz")).toBe("span");
    });

    it("detects OTEL 64-bit span ID", () => {
      expect(detectIdType("0123456789abcdef")).toBe("span");
    });

    it("is case insensitive for OTEL format", () => {
      expect(detectIdType("0123456789ABCDEF")).toBe("span");
    });
  });

  describe("non-ID queries", () => {
    it("returns null for regular search queries", () => {
      expect(detectIdType("my prompt")).toBeNull();
      expect(detectIdType("test agent")).toBeNull();
      expect(detectIdType("foo")).toBeNull();
    });

    it("returns null for empty or whitespace", () => {
      expect(detectIdType("")).toBeNull();
      expect(detectIdType("   ")).toBeNull();
    });

    it("returns null for partial prefixes", () => {
      expect(detectIdType("agent")).toBeNull();
      expect(detectIdType("trace")).toBeNull();
    });
  });
});
