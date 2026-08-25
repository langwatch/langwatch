import { describe, expect, it } from "vitest";
import {
  hasActionableTriggerFilters,
  isMatchEverythingTrigger,
} from "../src/trigger-policies";

const trigger = (overrides: Record<string, unknown> = {}) => ({
  triggerKind: "AUTOMATION" as const,
  customGraphId: null,
  filterQuery: null,
  filters: {},
  ...overrides,
});

describe("automation trigger policies", () => {
  it("treats nested empty filter values as vacuous", () => {
    expect(
      hasActionableTriggerFilters({
        "metadata.labels": { region: [] },
      }),
    ).toBe(false);
    expect(
      hasActionableTriggerFilters({
        "metadata.labels": { region: ["eu"] },
      }),
    ).toBe(true);
  });

  it("classifies only condition-less trace automations", () => {
    expect(isMatchEverythingTrigger(trigger())).toBe(true);
    expect(isMatchEverythingTrigger(trigger({ filters: { status: ["error"] } }))).toBe(
      false,
    );
    expect(isMatchEverythingTrigger(trigger({ filterQuery: "status:error" }))).toBe(
      false,
    );
    expect(isMatchEverythingTrigger(trigger({ customGraphId: "graph_1" }))).toBe(false);
    expect(isMatchEverythingTrigger(trigger({ triggerKind: "REPORT" }))).toBe(false);
  });
});
