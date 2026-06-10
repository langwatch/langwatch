import { describe, expect, it } from "vitest";
import {
  ATTRIBUTES_SECTION_KEY,
  EVENT_ATTRIBUTES_SECTION_KEY,
  FACET_GROUPS,
  type FacetGroupDef,
  getFacetGroupId,
  NONE_TOGGLE_VALUE,
  SPAN_ATTRIBUTES_SECTION_KEY,
} from "../constants";
import { partitionIntoGroups } from "../hooks/useFilterSidebarData";

/**
 * Round-3 reworked the FACET_GROUPS taxonomy from the shape-based
 * `trace / subjects / span / evaluators / metrics / prompts` set to
 * an AI-observability-focused 9-group scheme. These tests pin the new
 * structure so the popover's "browse by axis" layout doesn't silently
 * drift back toward the old shape-based grouping in a future audit.
 */
describe("FACET_GROUPS configuration", () => {
  it("declares each section key in exactly one group", () => {
    const occurrences = new Map<string, number>();
    for (const group of FACET_GROUPS) {
      for (const key of group.keys) {
        occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
      }
    }
    const duplicates = [...occurrences.entries()].filter(([, n]) => n > 1);
    expect(duplicates, `keys appearing in multiple groups: ${duplicates}`).toEqual([]);
  });

  it("orders the groups Origin → Model → Cost → Errors → Quality → Events → Subjects → Topics → Custom", () => {
    expect(FACET_GROUPS.map((g) => g.id)).toEqual([
      "origin",
      "model",
      "cost",
      "errors",
      "quality",
      "events",
      "subjects",
      "topics",
      "custom",
    ]);
  });

  it("scopes the trace-shape facets to the Origin group", () => {
    expect(getFacetGroupId("origin")).toBe("origin");
    expect(getFacetGroupId("rootSpanType")).toBe("origin");
    expect(getFacetGroupId("traceName")).toBe("origin");
  });

  it("scopes model/service to the Model group", () => {
    expect(getFacetGroupId("model")).toBe("model");
    expect(getFacetGroupId("service")).toBe("model");
  });

  it("scopes the cost + latency family to the Cost group", () => {
    for (const key of [
      "cost",
      "tokens",
      "promptTokens",
      "completionTokens",
      "duration",
      "ttft",
      "ttlt",
      "tokensPerSecond",
      "tokensEstimated",
      "spans",
    ]) {
      expect(getFacetGroupId(key)).toBe("cost");
    }
  });

  it("scopes status / errorMessage / guardrail / containsAi to the Errors group", () => {
    expect(getFacetGroupId("status")).toBe("errors");
    expect(getFacetGroupId("errorMessage")).toBe("errors");
    expect(getFacetGroupId("guardrail")).toBe("errors");
    expect(getFacetGroupId("containsAi")).toBe("errors");
  });

  it("scopes evaluator + annotation to the Quality group", () => {
    expect(getFacetGroupId("evaluator")).toBe("quality");
    expect(getFacetGroupId("evaluatorVerdict")).toBe("quality");
    expect(getFacetGroupId("evaluatorScore")).toBe("quality");
    expect(getFacetGroupId("annotation")).toBe("quality");
  });

  it("scopes per-span / per-event filters to the Events group", () => {
    expect(getFacetGroupId("event")).toBe("events");
    expect(getFacetGroupId("spanType")).toBe("events");
    expect(getFacetGroupId("spanName")).toBe("events");
    expect(getFacetGroupId("spanStatus")).toBe("events");
  });

  it("scopes user/conversation/customer/scenarioRun to the Subjects group", () => {
    expect(getFacetGroupId("user")).toBe("subjects");
    expect(getFacetGroupId("conversation")).toBe("subjects");
    expect(getFacetGroupId("customer")).toBe("subjects");
    expect(getFacetGroupId("scenarioRun")).toBe("subjects");
  });

  it("scopes topic/subtopic/label to the Topics group", () => {
    expect(getFacetGroupId("topic")).toBe("topics");
    expect(getFacetGroupId("subtopic")).toBe("topics");
    expect(getFacetGroupId("label")).toBe("topics");
  });

  it("scopes the dynamic-attributes sections and prompt fields to the Custom group", () => {
    expect(getFacetGroupId(ATTRIBUTES_SECTION_KEY)).toBe("custom");
    expect(getFacetGroupId(SPAN_ATTRIBUTES_SECTION_KEY)).toBe("custom");
    expect(getFacetGroupId(EVENT_ATTRIBUTES_SECTION_KEY)).toBe("custom");
    expect(getFacetGroupId("selectedPrompt")).toBe("custom");
    expect(getFacetGroupId("lastUsedPrompt")).toBe("custom");
    expect(getFacetGroupId("promptVersion")).toBe("custom");
  });

  it("wires `has:` / `none:` toggles for the identity-axis fields", () => {
    expect(NONE_TOGGLE_VALUE.user).toBe("user");
    expect(NONE_TOGGLE_VALUE.conversation).toBe("conversation");
    expect(NONE_TOGGLE_VALUE.customer).toBe("customer");
  });

  it("does NOT keep the legacy `trace` / `evaluators` / `metrics` / `prompts` group ids", () => {
    const ids = FACET_GROUPS.map((g) => g.id);
    for (const legacy of ["trace", "evaluators", "metrics", "prompts", "span"]) {
      expect(ids).not.toContain(legacy as FacetGroupDef["id"]);
    }
  });
});

describe("partitionIntoGroups", () => {
  describe("when no lens group order is supplied", () => {
    it("partitions keys into groups in registry order", () => {
      const slices = partitionIntoGroups(
        ["origin", "model", "duration", "status"],
        [],
      );
      const ids = slices.map((s) => s.id);
      expect(ids.indexOf("origin")).toBeLessThan(ids.indexOf("model"));
      expect(ids.indexOf("model")).toBeLessThan(ids.indexOf("cost"));
      expect(ids.indexOf("cost")).toBeLessThan(ids.indexOf("errors"));
    });

    it("preserves the input order of keys within a group (DnD-friendly)", () => {
      const slices = partitionIntoGroups(
        ["status", "errorMessage", "guardrail"],
        [],
      );
      const errors = slices.find((s) => s.id === "errors");
      expect(errors?.keys).toEqual(["status", "errorMessage", "guardrail"]);
    });

    it("only emits groups that actually have descriptors present", () => {
      const slices = partitionIntoGroups(["origin", "model"], []);
      const ids = slices.map((s) => s.id);
      expect(ids).toEqual(["origin", "model"]);
      expect(ids).not.toContain("cost");
      expect(ids).not.toContain("quality");
    });
  });

  describe("when a lens has stored a custom group order", () => {
    it("places lens-ordered groups first, then registry-default groups", () => {
      const slices = partitionIntoGroups(
        ["origin", "model", "status", "evaluator"],
        ["quality", "errors"],
      );
      const ids = slices.map((s) => s.id);
      expect(ids[0]).toBe("quality");
      expect(ids[1]).toBe("errors");
      expect(ids.slice(2)).toEqual(["origin", "model"]);
    });

    it("ignores legacy group ids in the stored lens order (e.g. removed `trace` / `evaluators`)", () => {
      const slices = partitionIntoGroups(
        ["origin", "status", "evaluator"],
        // Pre-rename ordering — legacy ids no longer exist.
        ["trace", "evaluators", "errors", "origin"],
      );
      const ids = slices.map((s) => s.id);
      expect(ids).not.toContain("trace" as FacetGroupDef["id"]);
      expect(ids).not.toContain("evaluators" as FacetGroupDef["id"]);
      expect(ids).toContain("errors");
      expect(ids).toContain("origin");
    });
  });

  describe("when the input contains an unknown key", () => {
    it("surfaces it under a synthetic trailing `Other` slice rather than dropping it silently", () => {
      const slices = partitionIntoGroups(
        ["origin", "definitelyNotAFacetKey"],
        [],
      );
      const last = slices[slices.length - 1];
      expect(last?.label).toBe("Other");
      expect(last?.keys).toEqual(["definitelyNotAFacetKey"]);
    });
  });
});
