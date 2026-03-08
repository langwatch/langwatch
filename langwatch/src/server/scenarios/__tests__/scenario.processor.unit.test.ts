/**
 * Unit tests for scenario processor.
 * @see specs/scenarios/simulation-runner.feature "Pass labels to SDK for tracing"
 */

import { describe, expect, it } from "vitest";
import { buildOtelResourceAttributes } from "../scenario.processor";

describe("buildOtelResourceAttributes", () => {
  it("always includes langwatch.origin.source=platform", () => {
    expect(buildOtelResourceAttributes([])).toBe(
      "langwatch.origin.source=platform",
    );
  });

  it("formats single label as OTEL resource attribute with source", () => {
    expect(buildOtelResourceAttributes(["support"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=support",
    );
  });

  it("formats multiple labels as comma-separated OTEL resource attribute", () => {
    expect(buildOtelResourceAttributes(["support", "billing"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=support,billing",
    );
  });

  it("escapes commas in label values", () => {
    expect(buildOtelResourceAttributes(["support,tier1"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=support\\,tier1",
    );
  });

  it("escapes equals signs in label values", () => {
    expect(buildOtelResourceAttributes(["priority=high"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=priority\\=high",
    );
  });
});
