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

  it("places the trace metadata Attributes section in the Trace group", () => {
    expect(getFacetGroupId(ATTRIBUTES_SECTION_KEY)).toBe("trace");
  });

  it("hosts the hoisted span event names in the Trace group", () => {
    expect(getFacetGroupId("event")).toBe("trace");
  });

  it("hosts the event-attributes section in the Trace group (events are hoisted to the trace at ingest)", () => {
    expect(getFacetGroupId(EVENT_ATTRIBUTES_SECTION_KEY)).toBe("trace");
  });

  it("does NOT keep user/conversation under Trace — they live in Subjects now", () => {
    const trace = FACET_GROUPS.find((g) => g.id === "trace");
    expect(trace?.keys).not.toContain("user");
    expect(trace?.keys).not.toContain("conversation");
  });

  it("keeps the dedicated Span group for any-span filters", () => {
    const span = FACET_GROUPS.find((g) => g.id === "span");
    expect(span).toBeDefined();
    expect(span?.keys).toContain("spanType");
  });

  it("hosts span name / status / attribute facets in the Span group", () => {
    expect(getFacetGroupId("spanName")).toBe("span");
    expect(getFacetGroupId("spanStatus")).toBe("span");
    expect(getFacetGroupId(SPAN_ATTRIBUTES_SECTION_KEY)).toBe("span");
  });

  it("places the Span attributes section *after* the categorical span facets so attribute drill-downs sit at the bottom", () => {
    const span = FACET_GROUPS.find((g) => g.id === "span");
    expect(span?.keys.indexOf("spanType")).toBeLessThan(
      span?.keys.indexOf(SPAN_ATTRIBUTES_SECTION_KEY) ?? -1,
    );
  });

  it("scopes evaluator-related facets to the Evaluators group", () => {
    expect(getFacetGroupId("annotation")).toBe("evaluators");
    expect(getFacetGroupId("evaluator")).toBe("evaluators");
    expect(getFacetGroupId("evaluatorScore")).toBe("evaluators");
  });

  it("keeps prompt facets in their own Prompts group", () => {
    expect(getFacetGroupId("selectedPrompt")).toBe("prompts");
    expect(getFacetGroupId("lastUsedPrompt")).toBe("prompts");
    expect(getFacetGroupId("promptVersion")).toBe("prompts");
  });

  it("does NOT define an `events` or `attributes` standalone group", () => {
    const ids = FACET_GROUPS.map((g) => g.id);
    expect(ids).not.toContain("events" as FacetGroupDef["id"]);
    expect(ids).not.toContain("attributes" as FacetGroupDef["id"]);
  });
});

describe("Subjects group — identity-axis facets", () => {
  it("renders between Trace and Span", () => {
    const ids = FACET_GROUPS.map((g) => g.id);
    expect(ids.indexOf("trace")).toBeLessThan(ids.indexOf("subjects"));
    expect(ids.indexOf("subjects")).toBeLessThan(ids.indexOf("span"));
  });

  it("contains user, conversation, customer, scenarioRun in that order", () => {
    const subjects = FACET_GROUPS.find((g) => g.id === "subjects");
    expect(subjects?.keys).toEqual([
      "user",
      "conversation",
      "customer",
      "scenarioRun",
    ]);
  });

  it("scopes each subjects key to the Subjects group", () => {
    expect(getFacetGroupId("user")).toBe("subjects");
    expect(getFacetGroupId("conversation")).toBe("subjects");
    expect(getFacetGroupId("customer")).toBe("subjects");
    expect(getFacetGroupId("scenarioRun")).toBe("subjects");
  });

  it("wires `has:`/`none:` toggles for customer alongside user/conversation", () => {
    expect(NONE_TOGGLE_VALUE.user).toBe("user");
    expect(NONE_TOGGLE_VALUE.conversation).toBe("conversation");
    expect(NONE_TOGGLE_VALUE.customer).toBe("customer");
  });
});

describe("partitionIntoGroups", () => {
  describe("when no lens group order is supplied", () => {
    it("partitions keys into groups in registry order", () => {
      const slices = partitionIntoGroups(["origin", "spanType", "duration"], []);
      const ids = slices.map((s) => s.id);
      expect(ids.indexOf("trace")).toBeLessThan(ids.indexOf("span"));
      expect(ids.indexOf("span")).toBeLessThan(ids.indexOf("metrics"));
    });

    it("preserves the input order of keys within a group (DnD-friendly)", () => {
      const slices = partitionIntoGroups(
        ["status", "origin", "errorMessage"],
        [],
      );
      const trace = slices.find((s) => s.id === "trace");
      expect(trace?.keys).toEqual(["status", "origin", "errorMessage"]);
    });

    it("only emits groups that actually have descriptors present", () => {
      const slices = partitionIntoGroups(["origin", "spanType"], []);
      const ids = slices.map((s) => s.id);
      expect(ids).toEqual(["trace", "span"]);
      // No empty Metrics / Evaluators / Prompts groups when discover hasn't
      // surfaced anything in those buckets yet.
      expect(ids).not.toContain("metrics");
    });
  });

  describe("when a lens has stored a custom group order", () => {
    it("places lens-ordered groups first, then registry-default groups", () => {
      const slices = partitionIntoGroups(
        ["origin", "spanType", "duration", "selectedPrompt"],
        ["span", "trace"],
      );
      const ids = slices.map((s) => s.id);
      // Lens explicitly ordered span → trace, and the rest come in registry order.
      expect(ids[0]).toBe("span");
      expect(ids[1]).toBe("trace");
      expect(ids.slice(2)).toEqual(["metrics", "prompts"]);
    });

    it("ignores legacy group ids in the stored lens order (e.g. removed `events`/`attributes`)", () => {
      const slices = partitionIntoGroups(
        ["origin", "event", ATTRIBUTES_SECTION_KEY, "spanType"],
        // Pre-rename ordering — both `events` and `attributes` are gone now.
        ["events", "attributes", "span", "trace"],
      );
      const ids = slices.map((s) => s.id);
      // No phantom group for the dead ids; what remains keeps its relative order.
      expect(ids).toContain("trace");
      expect(ids).toContain("span");
      expect(ids).not.toContain("events" as FacetGroupDef["id"]);
      expect(ids).not.toContain("attributes" as FacetGroupDef["id"]);
      // The Trace slice now absorbs `event` and the Attributes section.
      const trace = slices.find((s) => s.id === "trace");
      expect(trace?.keys).toContain("event");
      expect(trace?.keys).toContain(ATTRIBUTES_SECTION_KEY);
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
