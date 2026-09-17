import { describe, it, expect } from "vitest";
import { analyticsMetrics } from "../schemas/analytics-metrics.js";
import { analyticsGroups } from "../schemas/analytics-groups.js";

describe("schemas", () => {
  describe("analyticsMetrics", () => {
    it("covers expected categories", () => {
      const categories = new Set(analyticsMetrics.map((m) => m.category));
      expect(categories).toContain("metadata");
      expect(categories).toContain("performance");
      expect(categories).toContain("evaluations");
      expect(categories).toContain("sentiment");
      expect(categories).toContain("events");
    });

    it("has non-empty allowedAggregations for every metric", () => {
      for (const metric of analyticsMetrics) {
        expect(metric.allowedAggregations.length).toBeGreaterThan(0);
      }
    });

    it("has non-empty name, label, and description for every metric", () => {
      for (const metric of analyticsMetrics) {
        expect(metric.name).toBeTruthy();
        expect(metric.label).toBeTruthy();
        expect(metric.description).toBeTruthy();
      }
    });

    it("contains expected metrics", () => {
      const names = analyticsMetrics.map((m) => `${m.category}.${m.name}`);
      expect(names).toContain("metadata.trace_id");
      expect(names).toContain("performance.completion_time");
      expect(names).toContain("performance.total_cost");
      expect(names).toContain("evaluations.evaluation_score");
    });
  });

  describe("analyticsGroups", () => {
    it("has at least 10 entries", () => {
      expect(analyticsGroups.length).toBeGreaterThanOrEqual(10);
    });

    it("has non-empty name, label, and description for every group", () => {
      for (const group of analyticsGroups) {
        expect(group.name).toBeTruthy();
        expect(group.label).toBeTruthy();
        expect(group.description).toBeTruthy();
      }
    });

    it("contains expected group-by options", () => {
      const names = analyticsGroups.map((g) => g.name);
      expect(names).toContain("topics.topics");
      expect(names).toContain("metadata.user_id");
      expect(names).toContain("metadata.model");
      expect(names).toContain("events.event_type");
    });
  });
});
