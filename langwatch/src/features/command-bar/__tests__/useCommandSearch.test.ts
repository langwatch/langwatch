import { describe, it, expect } from "vitest";
import { detectEntityId } from "../useCommandSearch";

/**
 * Tests for entity ID detection in command search.
 * Uses the actual detectEntityId function for DRY compliance.
 */
describe("detectEntityId", () => {
  const PROJECT_SLUG = "test-project";

  /**
   * Helper to extract the type from detectEntityId result.
   * Returns "entity" for KSUID-prefixed items, or the actual type for traces/spans.
   */
  function detectIdType(query: string): "entity" | "trace" | "span" | null {
    const result = detectEntityId(query, PROJECT_SLUG);
    if (!result) return null;

    // KSUID-prefixed entities have id starting with "id-"
    if (result.id.startsWith("id-")) return "entity";

    // Trace and span types
    if (result.id.startsWith("trace-")) return "trace";
    if (result.id.startsWith("span-")) return "span";

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

    it("builds correct path for agent", () => {
      const result = detectEntityId("agent_abc123", PROJECT_SLUG);
      expect(result?.path).toBe(
        "/test-project/agents?drawer.open=agentViewer&drawer.agentId=agent_abc123"
      );
    });

    it("builds correct path for dataset", () => {
      const result = detectEntityId("dataset_xyz789", PROJECT_SLUG);
      expect(result?.path).toBe("/test-project/datasets/dataset_xyz789");
    });

    it("returns correct label format", () => {
      const result = detectEntityId("agent_abc123", PROJECT_SLUG);
      expect(result?.label).toBe("Go to Agent");
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

    it("includes drawerAction for traces", () => {
      const result = detectEntityId("trace_abc123", PROJECT_SLUG);
      expect(result?.drawerAction).toEqual({
        drawer: "traceDetails",
        params: { traceId: "trace_abc123" },
      });
    });

    it("builds correct path for trace", () => {
      const result = detectEntityId("trace_abc123", PROJECT_SLUG);
      expect(result?.path).toBe("/test-project/messages/trace_abc123");
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

    it("builds correct path for span (search query)", () => {
      const result = detectEntityId("span_abc123", PROJECT_SLUG);
      expect(result?.path).toBe(
        "/test-project/messages?query=span_abc123"
      );
    });

    it("does not include drawerAction for spans", () => {
      const result = detectEntityId("span_abc123", PROJECT_SLUG);
      expect(result?.drawerAction).toBeUndefined();
    });
  });

  describe("non-ID queries", () => {
    it("returns null for regular search queries", () => {
      expect(detectEntityId("my prompt", PROJECT_SLUG)).toBeNull();
      expect(detectEntityId("test agent", PROJECT_SLUG)).toBeNull();
      expect(detectEntityId("foo", PROJECT_SLUG)).toBeNull();
    });

    it("returns null for empty or whitespace", () => {
      expect(detectEntityId("", PROJECT_SLUG)).toBeNull();
      expect(detectEntityId("   ", PROJECT_SLUG)).toBeNull();
    });

    it("returns null for partial prefixes", () => {
      expect(detectEntityId("agent", PROJECT_SLUG)).toBeNull();
      expect(detectEntityId("trace", PROJECT_SLUG)).toBeNull();
    });

    it("returns null when projectSlug is empty", () => {
      expect(detectEntityId("agent_abc123", "")).toBeNull();
    });
  });
});
