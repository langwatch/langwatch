import { describe, it, expect } from "vitest";
import { LIMIT_TYPE_LABELS, LIMIT_TYPE_DISPLAY_LABELS } from "../constants";
import { limitTypes, type LimitType } from "../types";

describe("LIMIT_TYPE_LABELS", () => {
  it("provides a label for every LimitType", () => {
    for (const limitType of limitTypes) {
      expect(LIMIT_TYPE_LABELS[limitType]).toBeDefined();
      expect(typeof LIMIT_TYPE_LABELS[limitType]).toBe("string");
      expect(LIMIT_TYPE_LABELS[limitType].length).toBeGreaterThan(0);
    }
  });

  it("has the expected labels for each limit type", () => {
    expect(LIMIT_TYPE_LABELS.workflows).toBe("workflows");
    expect(LIMIT_TYPE_LABELS.prompts).toBe("prompts");
    expect(LIMIT_TYPE_LABELS.evaluators).toBe("evaluators");
    expect(LIMIT_TYPE_LABELS.scenarios).toBe("scenarios");
    expect(LIMIT_TYPE_LABELS.projects).toBe("projects");
    expect(LIMIT_TYPE_LABELS.members).toBe("team members");
  });

  it("is a complete Record with no missing keys", () => {
    const labelKeys = Object.keys(LIMIT_TYPE_LABELS) as LimitType[];
    expect(labelKeys.sort()).toEqual([...limitTypes].sort());
  });
});

describe("LIMIT_TYPE_DISPLAY_LABELS", () => {
  it("provides a display label for every LimitType", () => {
    for (const limitType of limitTypes) {
      expect(LIMIT_TYPE_DISPLAY_LABELS[limitType]).toBeDefined();
      expect(typeof LIMIT_TYPE_DISPLAY_LABELS[limitType]).toBe("string");
      expect(LIMIT_TYPE_DISPLAY_LABELS[limitType].length).toBeGreaterThan(0);
    }
  });

  it("has the expected display labels for each limit type (title case)", () => {
    expect(LIMIT_TYPE_DISPLAY_LABELS.workflows).toBe("Workflows");
    expect(LIMIT_TYPE_DISPLAY_LABELS.prompts).toBe("Prompts");
    expect(LIMIT_TYPE_DISPLAY_LABELS.evaluators).toBe("Evaluators");
    expect(LIMIT_TYPE_DISPLAY_LABELS.scenarios).toBe("Scenarios");
    expect(LIMIT_TYPE_DISPLAY_LABELS.projects).toBe("Projects");
    expect(LIMIT_TYPE_DISPLAY_LABELS.members).toBe("Team Members");
  });

  it("is a complete Record with no missing keys", () => {
    const labelKeys = Object.keys(LIMIT_TYPE_DISPLAY_LABELS) as LimitType[];
    expect(labelKeys.sort()).toEqual([...limitTypes].sort());
  });
});
