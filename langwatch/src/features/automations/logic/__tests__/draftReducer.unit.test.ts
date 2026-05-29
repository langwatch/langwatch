import { AlertType, TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  type AutomationDraft,
  EMPTY_FIELD,
  INITIAL_DRAFT,
  conditionsAreSet,
  configIsComplete,
  configurationSummary,
  notifyChannel,
  reducer,
  summariseConditions,
  templatesFromDraft,
} from "../draftReducer";

const SAMPLE: AutomationDraft = {
  ...INITIAL_DRAFT,
  name: "High latency",
  action: TriggerAction.SEND_EMAIL,
  alertType: AlertType.WARNING,
  members: ["a@acme.test"],
  filters: { "trace.tags": ["urgent"] as never },
};

describe("draftReducer", () => {
  describe("SET_ACTION", () => {
    it("clears destination-specific config so type-switching does not leak", () => {
      const next = reducer(SAMPLE, {
        type: "SET_ACTION",
        value: TriggerAction.SEND_SLACK_MESSAGE,
      });
      expect(next.action).toBe(TriggerAction.SEND_SLACK_MESSAGE);
      expect(next.members).toEqual([]);
      expect(next.name).toBe("High latency"); // identity preserved
    });
  });

  describe("SET_SOURCE", () => {
    describe("when switching to custom graph", () => {
      it("clears the trace filters", () => {
        const next = reducer(SAMPLE, { type: "SET_SOURCE", value: "customGraph" });
        expect(next.source).toBe("customGraph");
        expect(next.filters).toEqual({});
      });
    });
    describe("when switching back to trace", () => {
      it("clears the customGraphId", () => {
        const withGraph: AutomationDraft = {
          ...SAMPLE,
          source: "customGraph",
          customGraphId: "graph_1",
        };
        const next = reducer(withGraph, { type: "SET_SOURCE", value: "trace" });
        expect(next.source).toBe("trace");
        expect(next.customGraphId).toBeNull();
      });
    });
  });

  describe("SET_SLACK_TYPE", () => {
    it("resets the slack template to the default so the right default renders", () => {
      const dirty: AutomationDraft = {
        ...SAMPLE,
        slackTemplate: { value: "[1,2,3]", usingDefault: false },
      };
      const next = reducer(dirty, { type: "SET_SOURCE", value: "trace" });
      expect(next.slackTemplate).not.toEqual(EMPTY_FIELD);
      const swapped = reducer(dirty, {
        type: "SET_SLACK_TYPE",
        value: "block_kit",
      });
      expect(swapped.slackTemplateType).toBe("block_kit");
      expect(swapped.slackTemplate).toEqual(EMPTY_FIELD);
    });
  });
});

describe("conditionsAreSet", () => {
  describe("when the source is trace", () => {
    it("is true when any filter has a value", () => {
      expect(conditionsAreSet(SAMPLE)).toBe(true);
    });
    it("is false when filters are empty", () => {
      expect(conditionsAreSet({ ...SAMPLE, filters: {} })).toBe(false);
    });
  });
  describe("when the source is customGraph", () => {
    it("is true only when a graph id is set", () => {
      const a: AutomationDraft = {
        ...SAMPLE,
        source: "customGraph",
        filters: {},
      };
      expect(conditionsAreSet({ ...a, customGraphId: null })).toBe(false);
      expect(conditionsAreSet({ ...a, customGraphId: "g_1" })).toBe(true);
    });
  });
});

describe("configIsComplete", () => {
  it("requires a name and the type-specific destination", () => {
    expect(configIsComplete({ ...SAMPLE, name: "" })).toBe(false);
    expect(configIsComplete({ ...SAMPLE, members: [] })).toBe(false);
    expect(configIsComplete(SAMPLE)).toBe(true);
  });
});

describe("templatesFromDraft", () => {
  it("uses null when a field is using the default", () => {
    const out = templatesFromDraft(SAMPLE);
    expect(out.emailSubjectTemplate).toBeNull();
    expect(out.emailBodyTemplate).toBeNull();
  });
  it("uses the custom value when the field is dirty", () => {
    const dirty: AutomationDraft = {
      ...SAMPLE,
      emailSubject: { value: "Hi {{ trigger.name }}", usingDefault: false },
    };
    expect(templatesFromDraft(dirty).emailSubjectTemplate).toBe(
      "Hi {{ trigger.name }}",
    );
  });
});

describe("notifyChannel", () => {
  it("returns email / slack / null for the relevant actions", () => {
    expect(notifyChannel(SAMPLE)).toBe("email");
    expect(
      notifyChannel({ ...SAMPLE, action: TriggerAction.SEND_SLACK_MESSAGE }),
    ).toBe("slack");
    expect(notifyChannel({ ...SAMPLE, action: TriggerAction.ADD_TO_DATASET })).toBeNull();
  });
});

describe("summariseConditions", () => {
  it("describes trace filters by count and field names", () => {
    expect(summariseConditions(SAMPLE)).toMatch(/condition/);
  });
  it("describes a custom graph trigger", () => {
    expect(
      summariseConditions({
        ...SAMPLE,
        source: "customGraph",
        customGraphId: "graph_abc123def456",
      }),
    ).toMatch(/Custom graph/);
  });
});

describe("configurationSummary", () => {
  it("includes the destination kind", () => {
    expect(configurationSummary(SAMPLE)).toMatch(/email to 1 recipient/);
  });
});
