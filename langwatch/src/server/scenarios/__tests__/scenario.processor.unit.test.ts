/**
 * Unit tests for scenario processor.
 * @see specs/scenarios/simulation-runner.feature "Pass labels to SDK for tracing"
 */

import { describe, expect, it } from "vitest";
import { buildOtelResourceAttributes } from "../scenario.processor";

describe("buildOtelResourceAttributes", () => {
  it("always includes langwatch.source=platform", () => {
    expect(buildOtelResourceAttributes([])).toBe(
      "langwatch.source=platform",
    );
  });

  it("formats single label as OTEL resource attribute with source", () => {
    expect(buildOtelResourceAttributes(["support"])).toBe(
      "langwatch.source=platform,scenario.labels=support",
    );
  });

  it("formats multiple labels as comma-separated OTEL resource attribute", () => {
    expect(buildOtelResourceAttributes(["support", "billing"])).toBe(
      "langwatch.source=platform,scenario.labels=support,billing",
    );
  });

  it("escapes commas in label values", () => {
    expect(buildOtelResourceAttributes(["support,tier1"])).toBe(
      "langwatch.source=platform,scenario.labels=support\\,tier1",
    );
  });

  it("escapes equals signs in label values", () => {
    expect(buildOtelResourceAttributes(["priority=high"])).toBe(
      "langwatch.source=platform,scenario.labels=priority\\=high",
    );
  });
});
