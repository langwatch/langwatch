import { AlertType, TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import type { EmailSlice } from "~/automations/providers/definitions/email/client";
import {
  type AutomationDraft,
  conditionsAreSet,
  configIsComplete,
  configurationSummary,
  extractGraphAlertFromTriggerRow,
  filtersAreSet,
  INITIAL_DRAFT,
  INITIAL_GRAPH_ALERT_DRAFT,
  isNotifyAction,
  notifyChannel,
  reducer,
  summariseConditions,
  templatesFromDraft,
} from "../draftReducer";

const emailWith = (members: string[]): EmailSlice => ({
  ...(CLIENT_PROVIDERS[
    TriggerAction.SEND_EMAIL
  ].client.initialSlice() as EmailSlice),
  members,
});

const SAMPLE: AutomationDraft = {
  ...INITIAL_DRAFT,
  name: "High latency",
  action: TriggerAction.SEND_EMAIL,
  alertType: AlertType.WARNING,
  filters: { "traces.origin": ["sample"] as never },
  slices: {
    ...INITIAL_DRAFT.slices,
    [TriggerAction.SEND_EMAIL]: emailWith(["a@acme.test"]),
  },
};

describe("draftReducer", () => {
  describe("SET_ACTION", () => {
    it("changes the action but preserves every provider's slice", () => {
      const next = reducer(SAMPLE, {
        type: "SET_ACTION",
        value: TriggerAction.SEND_SLACK_MESSAGE,
      });
      expect(next.action).toBe(TriggerAction.SEND_SLACK_MESSAGE);
      // The email slice we set is still intact — switching type doesn't wipe it.
      expect(
        (next.slices[TriggerAction.SEND_EMAIL] as { members: string[] })
          .members,
      ).toEqual(["a@acme.test"]);
      expect(next.name).toBe("High latency");
    });
  });

  describe("SET_SLICE", () => {
    it("updates exactly the provider's slice", () => {
      const slack = {
        webhook: "https://hooks.slack.com/services/T/B/X",
        templateType: "string" as const,
        template: { value: "", usingDefault: true },
      };
      const next = reducer(SAMPLE, {
        type: "SET_SLICE",
        action: TriggerAction.SEND_SLACK_MESSAGE,
        slice: slack,
      });
      expect(next.slices[TriggerAction.SEND_SLACK_MESSAGE]).toEqual(slack);
      // The email slice is untouched.
      expect(next.slices[TriggerAction.SEND_EMAIL]).toEqual(
        SAMPLE.slices[TriggerAction.SEND_EMAIL],
      );
    });
  });

  describe("SET_SOURCE", () => {
    it("clears trace filters when switching to customGraph", () => {
      const next = reducer(SAMPLE, {
        type: "SET_SOURCE",
        value: "customGraph",
      });
      expect(next.source).toBe("customGraph");
      expect(next.filters).toEqual({});
    });
    it("clears the customGraphId when switching back to trace", () => {
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

  describe("cadence confirmation", () => {
    it("starts unconfirmed so a fresh draft can't ship unseen defaults", () => {
      expect(INITIAL_DRAFT.cadenceConfirmed).toBe(false);
    });
    it("confirms when the cadence is changed", () => {
      const next = reducer(SAMPLE, { type: "SET_CADENCE", value: "immediate" });
      expect(next.cadenceConfirmed).toBe(true);
    });
    it("confirms when the settle window is changed", () => {
      const next = reducer(SAMPLE, {
        type: "SET_TRACE_DEBOUNCE_MS",
        value: 60_000,
      });
      expect(next.cadenceConfirmed).toBe(true);
    });
    it("confirms on CONFIRM_CADENCE without touching the values", () => {
      const next = reducer(SAMPLE, { type: "CONFIRM_CADENCE" });
      expect(next.cadenceConfirmed).toBe(true);
      expect(next.notificationCadence).toBe(SAMPLE.notificationCadence);
      expect(next.traceDebounceMs).toBe(SAMPLE.traceDebounceMs);
    });
    it("returns the same state when already confirmed", () => {
      const confirmed = reducer(SAMPLE, { type: "CONFIRM_CADENCE" });
      expect(reducer(confirmed, { type: "CONFIRM_CADENCE" })).toBe(confirmed);
    });
  });
});

describe("filtersAreSet", () => {
  it("is true when any filter has a value", () => {
    expect(filtersAreSet(SAMPLE.filters)).toBe(true);
  });
  it("is false when filters are empty", () => {
    expect(filtersAreSet({})).toBe(false);
  });
});

describe("conditionsAreSet", () => {
  describe("when the source is customGraph", () => {
    it("is false without a graph id", () => {
      const a: AutomationDraft = {
        ...SAMPLE,
        source: "customGraph",
        filters: {},
        customGraphId: null,
        graphAlert: {
          seriesName: "0/value/avg",
          operator: "gt",
          threshold: 0.5,
          timePeriod: 60,
        },
      };
      expect(conditionsAreSet(a)).toBe(false);
    });

    it("is false when the graph is picked but no series is chosen", () => {
      const a: AutomationDraft = {
        ...SAMPLE,
        source: "customGraph",
        filters: {},
        customGraphId: "g_1",
        graphAlert: {
          ...INITIAL_GRAPH_ALERT_DRAFT,
          seriesName: "",
        },
      };
      expect(conditionsAreSet(a)).toBe(false);
    });

    it("is true once graph + series + finite threshold are set", () => {
      const a: AutomationDraft = {
        ...SAMPLE,
        source: "customGraph",
        filters: {},
        customGraphId: "g_1",
        graphAlert: {
          seriesName: "0/value/avg",
          operator: "gt",
          threshold: 250,
          timePeriod: 60,
        },
      };
      expect(conditionsAreSet(a)).toBe(true);
    });
  });
});

describe("SET_GRAPH_ALERT", () => {
  it("replaces the graph-alert draft slice", () => {
    const next = reducer(SAMPLE, {
      type: "SET_GRAPH_ALERT",
      value: {
        seriesName: "0/cost/sum",
        operator: "gte",
        threshold: 100,
        timePeriod: 1440,
      },
    });
    expect(next.graphAlert).toEqual({
      seriesName: "0/cost/sum",
      operator: "gte",
      threshold: 100,
      timePeriod: 1440,
    });
  });
});

describe("summariseConditions for graph alerts", () => {
  it("describes the rule when fully filled in", () => {
    const draft: AutomationDraft = {
      ...SAMPLE,
      source: "customGraph",
      customGraphId: "g_1",
      graphAlert: {
        seriesName: "0/latency/p95",
        operator: "gt",
        threshold: 250,
        timePeriod: 60,
      },
    };
    expect(summariseConditions(draft)).toMatch(
      /0\/latency\/p95.*greater than.*250.*over 1 hour/i,
    );
  });

  it("prompts for a graph when none is picked", () => {
    const draft: AutomationDraft = {
      ...SAMPLE,
      source: "customGraph",
      customGraphId: null,
    };
    expect(summariseConditions(draft)).toMatch(/pick a graph/i);
  });
});

describe("extractGraphAlertFromTriggerRow", () => {
  it("hydrates the saved threshold rule", () => {
    const result = extractGraphAlertFromTriggerRow({
      threshold: 0.9,
      operator: "lte",
      timePeriod: 1440,
      seriesName: "errors",
    });
    expect(result).toEqual({
      threshold: 0.9,
      operator: "lte",
      timePeriod: 1440,
      seriesName: "errors",
    });
  });

  it("falls back to defaults for a malformed row", () => {
    expect(extractGraphAlertFromTriggerRow(null)).toEqual(
      INITIAL_GRAPH_ALERT_DRAFT,
    );
    expect(
      extractGraphAlertFromTriggerRow({
        operator: "between",
        timePeriod: "ten",
        threshold: "x",
      }),
    ).toEqual(INITIAL_GRAPH_ALERT_DRAFT);
  });
});

describe("configIsComplete delegates to the provider", () => {
  it("is false without a name", () => {
    expect(configIsComplete({ ...SAMPLE, name: "" })).toBe(false);
  });
  it("matches the provider's isComplete output", () => {
    expect(configIsComplete(SAMPLE)).toBe(true);
    const noRecipients: AutomationDraft = {
      ...SAMPLE,
      slices: { ...SAMPLE.slices, [TriggerAction.SEND_EMAIL]: emailWith([]) },
    };
    expect(configIsComplete(noRecipients)).toBe(false);
  });
});

describe("templatesFromDraft", () => {
  it("returns nulls when the active action is not a notify provider", () => {
    const dataset: AutomationDraft = {
      ...SAMPLE,
      action: TriggerAction.ADD_TO_DATASET,
    };
    expect(templatesFromDraft(dataset)).toEqual({
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
      slackTemplate: null,
      slackTemplateType: null,
    });
  });
  it("delegates to the notify provider's templatesFromSlice", () => {
    const draft: AutomationDraft = {
      ...SAMPLE,
      slices: {
        ...SAMPLE.slices,
        [TriggerAction.SEND_EMAIL]: {
          ...emailWith(["a@acme.test"]),
          subject: { value: "Hi", usingDefault: false },
        },
      },
    };
    expect(templatesFromDraft(draft).emailSubjectTemplate).toBe("Hi");
  });
});

describe("notifyChannel + isNotifyAction", () => {
  it("returns the channel for notify providers and null otherwise", () => {
    expect(notifyChannel(SAMPLE)).toBe("email");
    expect(
      notifyChannel({ ...SAMPLE, action: TriggerAction.SEND_SLACK_MESSAGE }),
    ).toBe("slack");
    expect(
      notifyChannel({ ...SAMPLE, action: TriggerAction.ADD_TO_DATASET }),
    ).toBeNull();
  });
  it("isNotifyAction agrees", () => {
    expect(isNotifyAction(SAMPLE)).toBe(true);
    expect(
      isNotifyAction({ ...SAMPLE, action: TriggerAction.ADD_TO_DATASET }),
    ).toBe(false);
    expect(isNotifyAction({ ...SAMPLE, action: null })).toBe(false);
  });
});

describe("configurationSummary delegates to the provider", () => {
  it("uses the provider's summary for the active action", () => {
    expect(configurationSummary(SAMPLE)).toMatch(/email to 1 recipient/);
  });
});
