import { describe, expect, it } from "vitest";
import { buildTemplateContext } from "../templateContext";

const baseArgs = {
  trigger: {
    id: "trg_1",
    name: "High latency",
    message: "",
    alertType: null,
  },
  project: { name: "Acme", slug: "acme" },
  baseHost: "https://app.langwatch.ai",
};

describe("buildTemplateContext", () => {
  describe("when given trace matches", () => {
    it("builds trace URLs and the project URL from the base host", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ traceId: "trace_1", input: "in", output: "out" }],
      });
      expect(ctx.project.url).toBe("https://app.langwatch.ai/acme");
      expect(ctx.matches[0]?.trace.url).toBe(
        "https://app.langwatch.ai/acme/messages/trace_1",
      );
      expect(ctx.matches[0]?.trace.id).toBe("trace_1");
    });
  });

  describe("when a match is a custom graph", () => {
    it("builds the analytics graph URL", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ graphId: "graph_1" }],
      });
      expect(ctx.matches[0]?.trace.url).toBe(
        "https://app.langwatch.ai/acme/analytics/custom/graph_1",
      );
    });

    it("labels the match 'View Graph' and flags isCustomGraph", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ graphId: "graph_1" }],
      });
      expect(ctx.matches[0]?.trace.label).toBe("View Graph");
      expect(ctx.matches[0]?.trace.isCustomGraph).toBe(true);
    });
  });

  describe("when a match has neither a traceId nor a graphId", () => {
    it("falls back to the '#' placeholder URL and the 'View' label", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{}],
      });
      expect(ctx.matches[0]?.trace.url).toBe("#");
      expect(ctx.matches[0]?.trace.label).toBe("View");
      expect(ctx.matches[0]?.trace.isCustomGraph).toBe(false);
    });
  });

  describe("when given several matches", () => {
    it("sets the digest count to the number of matches", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ traceId: "a" }, { traceId: "b" }, { traceId: "c" }],
      });
      expect(ctx.digest.count).toBe(3);
    });
  });

  describe("when given a digest window", () => {
    it("serializes the bounds to ISO strings", () => {
      const start = new Date("2026-05-29T00:00:00.000Z");
      const end = new Date("2026-05-29T01:00:00.000Z");
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ traceId: "a" }],
        window: { start, end },
      });
      expect(ctx.digest.windowStart).toBe("2026-05-29T00:00:00.000Z");
      expect(ctx.digest.windowEnd).toBe("2026-05-29T01:00:00.000Z");
    });

    it("leaves the window null for an immediate dispatch", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ traceId: "a" }],
      });
      expect(ctx.digest.windowStart).toBeNull();
      expect(ctx.digest.windowEnd).toBeNull();
    });
  });
});
