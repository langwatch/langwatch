import { describe, expect, it } from "vitest";
import {
  ATTRIBUTES_SECTION_KEY,
  DEFAULT_PERSPECTIVE_ID,
  EVENT_ATTRIBUTES_SECTION_KEY,
  FACET_GROUPS,
  FACET_PERSPECTIVES,
  type FacetGroupDef,
  getFacetGroupId,
  groupOrderForPerspective,
  NONE_TOGGLE_VALUE,
  orderedGroupDefsForPerspective,
  SECTION_ORDER,
  SPAN_ATTRIBUTES_SECTION_KEY,
  sectionOrderForPerspective,
} from "../constants";
import { partitionIntoGroups } from "../hooks/useFilterSidebarData";

/**
 * Round-5 refined the 9-group AI-observability taxonomy into 12 finer
 * sub-groups (Cost split into Cost / Latency / Volume; Prompts split out of
 * Custom) so the three facet perspectives have meaningful lead groups. These
 * tests pin the new structure + the perspectives so neither silently drifts.
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
    expect(
      duplicates,
      `keys appearing in multiple groups: ${duplicates}`,
    ).toEqual([]);
  });

  it("orders the groups as the default Observability perspective", () => {
    expect(FACET_GROUPS.map((g) => g.id)).toEqual([
      "traces",
      "errors",
      "spans",
      "subjects",
      "latency",
      "volume",
      "cost",
      "model",
      "quality",
      "topics",
      "prompts",
      "custom",
    ]);
  });

  it("scopes the trace-shape facets to the Traces group", () => {
    expect(getFacetGroupId("origin")).toBe("traces");
    expect(getFacetGroupId("rootSpanType")).toBe("traces");
    expect(getFacetGroupId("traceName")).toBe("traces");
  });

  it("scopes model/service to the Model group", () => {
    expect(getFacetGroupId("model")).toBe("model");
    expect(getFacetGroupId("service")).toBe("model");
  });

  it("splits the cost / latency / volume families into their own groups", () => {
    for (const key of [
      "cost",
      "tokens",
      "promptTokens",
      "completionTokens",
      "tokensEstimated",
    ]) {
      expect(getFacetGroupId(key)).toBe("cost");
    }
    for (const key of ["duration", "ttft", "ttlt", "tokensPerSecond"]) {
      expect(getFacetGroupId(key)).toBe("latency");
    }
    for (const key of ["spans", "size"]) {
      expect(getFacetGroupId(key)).toBe("volume");
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

  it("scopes per-span / per-event filters to the Spans group", () => {
    expect(getFacetGroupId("event")).toBe("spans");
    expect(getFacetGroupId("spanType")).toBe("spans");
    expect(getFacetGroupId("spanName")).toBe("spans");
    expect(getFacetGroupId("spanStatus")).toBe("spans");
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

  it("scopes the prompt-configuration fields to the Prompts group", () => {
    expect(getFacetGroupId("selectedPrompt")).toBe("prompts");
    expect(getFacetGroupId("lastUsedPrompt")).toBe("prompts");
    expect(getFacetGroupId("promptVersion")).toBe("prompts");
  });

  it("scopes the dynamic-attribute sections beside the fields they belong to", () => {
    // Trace attributes live with the Traces fields; span + event attributes
    // live with the Spans & Events fields — not in a catch-all Custom group.
    expect(getFacetGroupId(ATTRIBUTES_SECTION_KEY)).toBe("traces");
    expect(getFacetGroupId(SPAN_ATTRIBUTES_SECTION_KEY)).toBe("spans");
    expect(getFacetGroupId(EVENT_ATTRIBUTES_SECTION_KEY)).toBe("spans");
  });

  it("wires `has:` / `none:` toggles for the identity-axis fields", () => {
    expect(NONE_TOGGLE_VALUE.user).toBe("user");
    expect(NONE_TOGGLE_VALUE.conversation).toBe("conversation");
    expect(NONE_TOGGLE_VALUE.customer).toBe("customer");
  });

  it("does NOT keep the legacy group ids", () => {
    const ids = FACET_GROUPS.map((g) => g.id);
    for (const legacy of [
      "trace",
      "evaluators",
      "metrics",
      "span",
      "origin",
      "events",
    ]) {
      expect(ids).not.toContain(legacy as FacetGroupDef["id"]);
    }
  });
});

describe("facet perspectives", () => {
  it("offers Observability, LLM and Cost & Performance", () => {
    expect(FACET_PERSPECTIVES.map((p) => p.id)).toEqual([
      "observability",
      "llm",
      "cost-performance",
    ]);
  });

  it("defaults to Observability", () => {
    expect(DEFAULT_PERSPECTIVE_ID).toBe("observability");
  });

  it("covers every group in every perspective (no facet ever dropped)", () => {
    const allGroupIds = [...FACET_GROUPS.map((g) => g.id)].sort();
    for (const p of FACET_PERSPECTIVES) {
      const order = [...groupOrderForPerspective(p.id)].sort();
      expect(order, `perspective ${p.id}`).toEqual(allGroupIds);
    }
  });

  it("covers every section key in every perspective with no duplicates", () => {
    const allKeys = [...SECTION_ORDER].sort();
    for (const p of FACET_PERSPECTIVES) {
      const keys = sectionOrderForPerspective(p.id);
      expect(new Set(keys).size, `perspective ${p.id} duplicates`).toBe(
        keys.length,
      );
      expect([...keys].sort(), `perspective ${p.id}`).toEqual(allKeys);
    }
  });

  it("makes the Observability perspective match the registry (default) order", () => {
    expect(sectionOrderForPerspective("observability")).toEqual(SECTION_ORDER);
  });

  it("front-loads cost / latency / volume in the Cost & Performance perspective", () => {
    const leadIds = orderedGroupDefsForPerspective("cost-performance")
      .slice(0, 3)
      .map((g) => g.id);
    expect(leadIds).toEqual(["cost", "latency", "volume"]);
  });

  it("front-loads model / prompts / quality in the LLM perspective", () => {
    const leadIds = orderedGroupDefsForPerspective("llm")
      .slice(0, 3)
      .map((g) => g.id);
    expect(leadIds).toEqual(["model", "prompts", "quality"]);
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
      // Registry order surfaces traces → errors → latency → model.
      expect(ids.indexOf("traces")).toBeLessThan(ids.indexOf("errors"));
      expect(ids.indexOf("errors")).toBeLessThan(ids.indexOf("latency"));
      expect(ids.indexOf("latency")).toBeLessThan(ids.indexOf("model"));
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
      expect(ids).toEqual(["traces", "model"]);
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
      expect(ids.slice(2)).toEqual(["traces", "model"]);
    });

    it("ignores legacy group ids in the stored lens order (e.g. pre-refinement `origin` / `events`)", () => {
      const slices = partitionIntoGroups(
        ["origin", "status", "event"],
        ["origin", "events", "errors", "traces"],
      );
      const ids = slices.map((s) => s.id);
      expect(ids).not.toContain("origin" as FacetGroupDef["id"]);
      expect(ids).not.toContain("events" as FacetGroupDef["id"]);
      expect(ids).toContain("errors");
      expect(ids).toContain("traces");
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
