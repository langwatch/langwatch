/**
 * Unit tests for scenario processor.
 * @see specs/scenarios/simulation-runner.feature "Pass labels to SDK for tracing"
 */

import { describe, expect, it } from "vitest";
import { buildOtelResourceAttributes } from "../scenario.processor";

describe("buildOtelResourceAttributes", () => {
  it("returns undefined for empty labels", () => {
    expect(buildOtelResourceAttributes([])).toBeUndefined();
  });

  it("formats single label as OTEL resource attribute", () => {
    expect(buildOtelResourceAttributes(["support"])).toBe(
      "scenario.labels=support",
    );
  });

  it("formats multiple labels as comma-separated OTEL resource attribute", () => {
    expect(buildOtelResourceAttributes(["support", "billing"])).toBe(
      "scenario.labels=support,billing",
    );
  });

  it("escapes commas in label values", () => {
    expect(buildOtelResourceAttributes(["support,tier1"])).toBe(
      "scenario.labels=support\\,tier1",
    );
  });

  it("escapes equals signs in label values", () => {
    expect(buildOtelResourceAttributes(["priority=high"])).toBe(
      "scenario.labels=priority\\=high",
    );
  });
});
