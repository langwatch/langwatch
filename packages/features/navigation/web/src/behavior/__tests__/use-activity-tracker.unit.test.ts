/**
 * What Quick Search records as you move through the product.
 *
 * THE SUITE READS THE REAL TABLE NOW. It travelled with a second copy of
 * `parseEntityUrl` declared inline and asserted against that copy, which is a
 * test that cannot fail on a change to the product: the patterns could drift
 * and every assertion would still pass. The hook exports the function, so the
 * expectations below are pinned to the thing that runs.
 *
 * The expectations themselves are unchanged, which is what makes the two
 * `messages` cases worth reading: the legacy trace and span addresses are
 * still recognised, because history entries written before the redirect landed
 * still name them.
 */

import { describe, expect, it } from "vitest";
import { parseEntityUrl } from "../use-activity-tracker";

describe("useActivityTracker URL parsing", () => {
  describe("trace detection", () => {
    it("detects trace page URL", () => {
      const result = parseEntityUrl("/my-project/messages/trace_abc123", "my-project");
      expect(result).toMatchObject({
        type: "trace",
        id: "trace_abc123",
        iconName: "traces",
      });
    });

    it("detects OTEL trace ID format", () => {
      const result = parseEntityUrl(
        "/my-project/messages/0123456789abcdef0123456789abcdef",
        "my-project",
      );
      expect(result).toMatchObject({
        type: "trace",
        id: "0123456789abcdef0123456789abcdef",
        iconName: "traces",
      });
    });
  });

  describe("span detection", () => {
    it("detects span page URL", () => {
      const result = parseEntityUrl("/my-project/messages/trace_abc/spans/span_xyz", "my-project");
      expect(result).toMatchObject({
        type: "span",
        id: "span_xyz",
        iconName: "traces",
      });
    });
  });

  describe("workflow detection", () => {
    it("detects workflow page URL", () => {
      const result = parseEntityUrl("/my-project/workflows/workflow_abc123", "my-project");
      expect(result).toMatchObject({
        type: "entity",
        id: "workflow_abc123",
        iconName: "workflow",
      });
    });
  });

  describe("dataset detection", () => {
    it("detects dataset page URL", () => {
      const result = parseEntityUrl("/my-project/datasets/dataset_abc123", "my-project");
      expect(result).toMatchObject({
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
        "my-project",
      );
      expect(result).toMatchObject({
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
      const result = parseEntityUrl("/my-project/messages/trace_abc?tab=details", "my-project");
      expect(result).toMatchObject({
        type: "trace",
        id: "trace_abc",
        iconName: "traces",
      });
    });
  });
});
