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
    const result = detectEntityId({ query, projectSlug: PROJECT_SLUG });
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
      ["scenario_s1", "entity"],
      ["scen_s1", "entity"],
      ["monitor_m1", "entity"],
    ])("detects %s as %s", (input, expected) => {
      expect(detectIdType(input)).toBe(expected);
    });

    it("builds correct path for agent", () => {
      const result = detectEntityId({
        query: "agent_abc123",
        projectSlug: PROJECT_SLUG,
      });
      expect(result?.path).toBe(
        "/test-project/agents?drawer.open=agentViewer&drawer.agentId=agent_abc123"
      );
    });

    it("builds correct path for dataset", () => {
      const result = detectEntityId({
        query: "dataset_xyz789",
        projectSlug: PROJECT_SLUG,
      });
      expect(result?.path).toBe("/test-project/datasets/dataset_xyz789");
    });

    it("returns correct label format", () => {
      const result = detectEntityId({
        query: "agent_abc123",
        projectSlug: PROJECT_SLUG,
      });
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

    describe("when traces v2 is disabled (default)", () => {
      it("includes traceDetails drawerAction", () => {
        const result = detectEntityId({
          query: "trace_abc123",
          projectSlug: PROJECT_SLUG,
        });
        expect(result?.drawerAction).toEqual({
          drawer: "traceDetails",
          params: { traceId: "trace_abc123" },
        });
      });

      it("builds v1 /messages path", () => {
        const result = detectEntityId({
          query: "trace_abc123",
          projectSlug: PROJECT_SLUG,
        });
        expect(result?.path).toBe("/test-project/messages/trace_abc123");
      });
    });

    describe("when traces v2 is enabled", () => {
      it("navigates to v2 /traces with drawer params (no in-place drawerAction)", () => {
        const result = detectEntityId({
          query: "trace_abc123",
          projectSlug: PROJECT_SLUG,
          tracesV2Enabled: true,
        });
        expect(result?.path).toBe(
          "/test-project/traces?drawer.open=traceV2Details&drawer.traceId=trace_abc123"
        );
        expect(result?.drawerAction).toBeUndefined();
      });
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

    describe("when traces v2 is disabled (default)", () => {
      it("builds v1 /messages search path", () => {
        const result = detectEntityId({
          query: "span_abc123",
          projectSlug: PROJECT_SLUG,
        });
        expect(result?.path).toBe("/test-project/messages?query=span_abc123");
      });

      it("does not include drawerAction", () => {
        const result = detectEntityId({
          query: "span_abc123",
          projectSlug: PROJECT_SLUG,
        });
        expect(result?.drawerAction).toBeUndefined();
      });
    });

    describe("when traces v2 is enabled", () => {
      it("builds v2 /traces fragment path with spanId query-language clause", () => {
        const result = detectEntityId({
          query: "span_abc123",
          projectSlug: PROJECT_SLUG,
          tracesV2Enabled: true,
        });
        expect(result?.path).toBe(
          "/test-project/traces#all-traces?q=spanId%3Aspan_abc123"
        );
      });
    });
  });

  describe("non-ID queries", () => {
    it("returns null for regular search queries", () => {
      expect(
        detectEntityId({ query: "my prompt", projectSlug: PROJECT_SLUG })
      ).toBeNull();
      expect(
        detectEntityId({ query: "test agent", projectSlug: PROJECT_SLUG })
      ).toBeNull();
      expect(
        detectEntityId({ query: "foo", projectSlug: PROJECT_SLUG })
      ).toBeNull();
    });

    it("returns null for empty or whitespace", () => {
      expect(
        detectEntityId({ query: "", projectSlug: PROJECT_SLUG })
      ).toBeNull();
      expect(
        detectEntityId({ query: "   ", projectSlug: PROJECT_SLUG })
      ).toBeNull();
    });

    it("returns null for partial prefixes", () => {
      expect(
        detectEntityId({ query: "agent", projectSlug: PROJECT_SLUG })
      ).toBeNull();
      expect(
        detectEntityId({ query: "trace", projectSlug: PROJECT_SLUG })
      ).toBeNull();
    });

    it("returns null when projectSlug is empty", () => {
      expect(
        detectEntityId({ query: "agent_abc123", projectSlug: "" })
      ).toBeNull();
    });
  });
});
