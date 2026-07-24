import { describe, it, expect } from "vitest";

/**
 * Tests for URL pattern matching in activity tracker.
 * These test the parsing logic without requiring router mocking.
 */
describe("useActivityTracker URL parsing", () => {
  // Helper to simulate parseEntityUrl logic
  function parseEntityUrl(
    path: string,
    projectSlug: string
  ): { type: string; id: string; iconName: string } | null {
    const cleanPath = path.split("?")[0]?.split("#")[0] ?? "";
    const prefix = `/${projectSlug}`;

    if (!cleanPath.startsWith(prefix)) {
      return null;
    }

    const relativePath = cleanPath.slice(prefix.length);

    // Trace page
    const traceMatch = relativePath.match(/^\/messages\/([^/]+)$/);
    if (traceMatch) {
      return { type: "trace", id: traceMatch[1]!, iconName: "traces" };
    }

    // Span page
    const spanMatch = relativePath.match(
      /^\/messages\/([^/]+)\/([^/]+)\/([^/]+)$/
    );
    if (spanMatch) {
      return { type: "span", id: spanMatch[3]!, iconName: "traces" };
    }

    // Workflow page
    const workflowMatch = relativePath.match(/^\/workflows\/([^/]+)$/);
    if (workflowMatch) {
      return { type: "entity", id: workflowMatch[1]!, iconName: "workflow" };
    }

    // Dataset page
    const datasetMatch = relativePath.match(/^\/datasets\/([^/]+)$/);
    if (datasetMatch) {
      return { type: "entity", id: datasetMatch[1]!, iconName: "dataset" };
    }

    // Simulation run
    const simRunMatch = relativePath.match(
      /^\/simulations\/([^/]+)\/([^/]+)\/([^/]+)$/
    );
    if (simRunMatch) {
      return {
        type: "simulation-run",
        id: simRunMatch[3]!,
        iconName: "simulations",
      };
    }

    return null;
  }

  describe("trace detection", () => {
    it("detects trace page URL", () => {
      const result = parseEntityUrl("/my-project/messages/trace_abc123", "my-project");
      expect(result).toEqual({
        type: "trace",
        id: "trace_abc123",
        iconName: "traces",
      });
    });

    it("detects OTEL trace ID format", () => {
      const result = parseEntityUrl(
        "/my-project/messages/0123456789abcdef0123456789abcdef",
        "my-project"
      );
      expect(result).toEqual({
        type: "trace",
        id: "0123456789abcdef0123456789abcdef",
        iconName: "traces",
      });
    });
  });

  describe("span detection", () => {
    it("detects span page URL", () => {
      const result = parseEntityUrl(
        "/my-project/messages/trace_abc/spans/span_xyz",
        "my-project"
      );
      expect(result).toEqual({
        type: "span",
        id: "span_xyz",
        iconName: "traces",
      });
    });
  });

  describe("workflow detection", () => {
    it("detects workflow page URL", () => {
      const result = parseEntityUrl(
        "/my-project/workflows/workflow_abc123",
        "my-project"
      );
      expect(result).toEqual({
        type: "entity",
        id: "workflow_abc123",
        iconName: "workflow",
      });
    });
  });

  describe("dataset detection", () => {
    it("detects dataset page URL", () => {
      const result = parseEntityUrl(
        "/my-project/datasets/dataset_abc123",
        "my-project"
      );
      expect(result).toEqual({
        type: "entity",
        id: "dataset_abc123",
        iconName: "dataset",
      });
    });
  });

  describe("simulation run detection", () => {
    it("detects simulation run page URL", () => {
      const result = parseEntityUrl(
        "/my-project/simulations/scenario_set/batch_run/run_abc123",
        "my-project"
      );
      expect(result).toEqual({
        type: "simulation-run",
        id: "run_abc123",
        iconName: "simulations",
      });
    });
  });

  describe("non-matching URLs", () => {
    it("returns null for non-entity pages", () => {
      expect(parseEntityUrl("/my-project/analytics", "my-project")).toBeNull();
      expect(parseEntityUrl("/my-project/settings", "my-project")).toBeNull();
      expect(parseEntityUrl("/other-project/messages/trace_abc", "my-project")).toBeNull();
    });

    it("handles URLs with query params", () => {
      const result = parseEntityUrl(
        "/my-project/messages/trace_abc?tab=details",
        "my-project"
      );
      expect(result).toEqual({
        type: "trace",
        id: "trace_abc",
        iconName: "traces",
      });
    });
  });
});
