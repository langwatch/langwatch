import { AlertType, TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import type { EmailSlice } from "~/automations/providers/definitions/email/client";
import {
  type AutomationDraft,
  buildTestFirePayload,
  cadenceIsSet,
  conditionsAreSet,
  configIsComplete,
  configurationSummary,
  extractGraphAlertFromTriggerRow,
  filtersAreSet,
  INITIAL_DRAFT,
  INITIAL_GRAPH_ALERT_DRAFT,
  INITIAL_REPORT_DRAFT,
  presetLabels,
  reportInputFromDraft,
  isNotifyAction,
  notifyChannel,
  reducer,
  subjectIsSet,
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
        deliveryMethod: "webhook" as const,
        webhook: "https://hooks.slack.com/services/T/B/X",
        botToken: "",
        channelId: "",
        botTokenAlreadySet: false,
        isLegacyWebhook: false,
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
    it("keeps a notify action when switching to customGraph", () => {
      const next = reducer(SAMPLE, {
        type: "SET_SOURCE",
        value: "customGraph",
      });
      expect(next.action).toBe(TriggerAction.SEND_EMAIL);
    });
    it("resets a persist action when switching to customGraph", () => {
      const withDataset: AutomationDraft = {
        ...SAMPLE,
        action: TriggerAction.ADD_TO_DATASET,
      };
      const next = reducer(withDataset, {
        type: "SET_SOURCE",
        value: "customGraph",
      });
      expect(next.action).toBeNull();
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

    it("is false without an alert severity", () => {
      const a: AutomationDraft = {
        ...SAMPLE,
        source: "customGraph",
        filters: {},
        customGraphId: "g_1",
        alertType: null,
        graphAlert: {
          seriesName: "0/value/avg",
          operator: "gt",
          threshold: 250,
          timePeriod: 60,
        },
      };
      expect(conditionsAreSet(a)).toBe(false);
    });

    it("is true once graph + series + finite threshold + severity are set", () => {
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

describe("subjectIsSet + cadenceIsSet split", () => {
  describe("when the source is customGraph", () => {
    const alert: AutomationDraft = {
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

    it("subjectIsSet needs a graph and a series", () => {
      expect(subjectIsSet(alert)).toBe(true);
      expect(subjectIsSet({ ...alert, customGraphId: null })).toBe(false);
      expect(
        subjectIsSet({
          ...alert,
          graphAlert: { ...alert.graphAlert, seriesName: "" },
        }),
      ).toBe(false);
    });

    it("cadenceIsSet needs a finite threshold, not a severity", () => {
      expect(cadenceIsSet(alert)).toBe(true);
      // Severity is a separate facet — cadence stays set without it.
      expect(cadenceIsSet({ ...alert, alertType: null })).toBe(true);
      expect(
        cadenceIsSet({
          ...alert,
          graphAlert: { ...alert.graphAlert, threshold: NaN },
        }),
      ).toBe(false);
    });
  });

  describe("when the source is report", () => {
    it("subjectIsSet follows the content source, cadenceIsSet follows the cron", () => {
      const report: AutomationDraft = {
        ...SAMPLE,
        source: "report",
        report: { ...INITIAL_REPORT_DRAFT },
      };
      expect(subjectIsSet(report)).toBe(true);
      expect(cadenceIsSet(report)).toBe(true);
      expect(
        subjectIsSet({
          ...report,
          report: {
            ...INITIAL_REPORT_DRAFT,
            sourceKind: "dashboard",
            dashboardId: null,
          },
        }),
      ).toBe(false);
      expect(
        cadenceIsSet({
          ...report,
          report: { ...INITIAL_REPORT_DRAFT, cron: "  " },
        }),
      ).toBe(false);
    });
  });

  describe("when the source is trace", () => {
    it("subjectIsSet follows the filters and cadenceIsSet is always true", () => {
      expect(subjectIsSet(SAMPLE)).toBe(true);
      expect(subjectIsSet({ ...SAMPLE, filters: {} })).toBe(false);
      expect(cadenceIsSet({ ...SAMPLE, filters: {} })).toBe(true);
    });

    it("subjectIsSet accepts a filterQuery even without structured filters", () => {
      const query: AutomationDraft = {
        ...SAMPLE,
        filters: {},
        filterQuery: "status:error",
      };
      expect(subjectIsSet(query)).toBe(true);
      // Whitespace-only query is not a subject.
      expect(subjectIsSet({ ...query, filterQuery: "   " })).toBe(false);
    });
  });
});

describe("SET_FILTER_QUERY", () => {
  it("sets the trace-subject query", () => {
    const next = reducer(INITIAL_DRAFT, {
      type: "SET_FILTER_QUERY",
      value: "model:gpt-4o",
    });
    expect(next.filterQuery).toBe("model:gpt-4o");
  });

  it("is cleared when switching away from the trace source", () => {
    const withQuery = reducer(INITIAL_DRAFT, {
      type: "SET_FILTER_QUERY",
      value: "status:error",
    });
    expect(
      reducer(withQuery, { type: "SET_SOURCE", value: "customGraph" })
        .filterQuery,
    ).toBeNull();
    expect(
      reducer(withQuery, { type: "SET_SOURCE", value: "report" }).filterQuery,
    ).toBeNull();
  });
});

describe("presetLabels", () => {
  it("keys the noun set on the preset for a trace automation", () => {
    expect(presetLabels("trace", false)).toEqual({
      title: "Add automation",
      saveButton: "Create automation",
      createdToast: "Automation created",
      updatedToast: "Automation updated",
      noun: "automation",
    });
    expect(presetLabels("trace", true).title).toBe("Edit automation");
    expect(presetLabels("trace", true).saveButton).toBe("Save changes");
  });

  it("gives an alert its own copy", () => {
    expect(presetLabels("customGraph", false)).toMatchObject({
      title: "New alert",
      saveButton: "Create alert",
      createdToast: "Alert created",
      noun: "alert",
    });
    expect(presetLabels("customGraph", true).title).toBe("Edit alert");
  });

  it("gives a report report copy — never automation copy (field-5015)", () => {
    const create = presetLabels("report", false);
    expect(create).toMatchObject({
      title: "New report",
      saveButton: "Create report",
      createdToast: "Report created",
      updatedToast: "Report updated",
      noun: "report",
    });
    expect(create.saveButton).not.toMatch(/automation/i);
    expect(presetLabels("report", true).title).toBe("Edit report");
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
  it("stays true without a name — the name gates Save, not the section indicator", () => {
    expect(configIsComplete({ ...SAMPLE, name: "" })).toBe(true);
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

describe("buildTestFirePayload sends the graph-alert discriminator", () => {
  describe("given a trace-automation draft", () => {
    it("sets graphAlert to null so the server renders the trace context", () => {
      const payload = buildTestFirePayload({
        draft: SAMPLE,
        projectId: "proj_1",
        channel: "email",
        webhook: "",
      });
      expect(payload.graphAlert).toBeNull();
      expect(payload.channel).toBe("email");
      expect(payload.trigger.name).toBe("High latency");
    });
  });

  describe("given a graph-alert draft", () => {
    it("carries a non-null graphAlert with the rule + resolved labels (field-5015 regression)", () => {
      const alertDraft: AutomationDraft = {
        ...SAMPLE,
        source: "customGraph",
        customGraphId: "graph_1",
        graphAlert: {
          ...INITIAL_GRAPH_ALERT_DRAFT,
          seriesName: "0/trace_id/cardinality",
          operator: "gt",
          threshold: 10,
          timePeriod: 30,
        },
      };
      const payload = buildTestFirePayload({
        draft: alertDraft,
        projectId: "proj_1",
        channel: "slack",
        webhook: "https://hooks.slack.com/services/x",
        graphName: "Traces count",
        seriesLabel: "Traces count",
      });
      expect(payload.graphAlert).not.toBeNull();
      expect(payload.graphAlert).toMatchObject({
        graphName: "Traces count",
        metricLabel: "Traces count",
        operator: "gt",
        threshold: 10,
        timePeriodMinutes: 30,
      });
    });
  });
});


describe("report source", () => {
  describe("SET_SOURCE report", () => {
    it("switches to report, clears trace filters + graph id, keeps a notify action", () => {
      const withGraph: AutomationDraft = {
        ...SAMPLE,
        source: "customGraph",
        customGraphId: "g_1",
        action: TriggerAction.SEND_EMAIL,
      };
      const next = reducer(withGraph, { type: "SET_SOURCE", value: "report" });
      expect(next.source).toBe("report");
      expect(next.filters).toEqual({});
      expect(next.customGraphId).toBeNull();
      expect(next.action).toBe(TriggerAction.SEND_EMAIL);
    });
    it("drops a persist action when switching to report", () => {
      const next = reducer(
        { ...SAMPLE, action: TriggerAction.ADD_TO_DATASET },
        { type: "SET_SOURCE", value: "report" },
      );
      expect(next.action).toBeNull();
    });
  });

  describe("SET_REPORT", () => {
    it("replaces the report draft", () => {
      const next = reducer(SAMPLE, {
        type: "SET_REPORT",
        value: { ...INITIAL_REPORT_DRAFT, topN: 10, cron: "0 7 * * *" },
      });
      expect(next.report.topN).toBe(10);
      expect(next.report.cron).toBe("0 7 * * *");
    });
  });

  describe("conditionsAreSet for reports", () => {
    it("is true for a trace-query report with a schedule", () => {
      const d: AutomationDraft = {
        ...SAMPLE,
        source: "report",
        report: { ...INITIAL_REPORT_DRAFT },
      };
      expect(conditionsAreSet(d)).toBe(true);
    });
    it("is false for a customGraph report without a graph id", () => {
      const d: AutomationDraft = {
        ...SAMPLE,
        source: "report",
        report: { ...INITIAL_REPORT_DRAFT, sourceKind: "customGraph", customGraphId: null },
      };
      expect(conditionsAreSet(d)).toBe(false);
    });
    it("is false without a schedule", () => {
      const d: AutomationDraft = {
        ...SAMPLE,
        source: "report",
        report: { ...INITIAL_REPORT_DRAFT, cron: "  " },
      };
      expect(conditionsAreSet(d)).toBe(false);
    });
  });

  describe("reportInputFromDraft", () => {
    it("maps a trace-query report to the discriminated input", () => {
      const out = reportInputFromDraft({ ...INITIAL_REPORT_DRAFT, topN: 7 });
      expect(out.source).toEqual({ kind: "traceQuery", filters: {}, topN: 7 });
      expect(out.schedule).toEqual({ cron: "0 9 * * 1", timezone: "UTC" });
    });
    it("maps a custom-graph report", () => {
      const out = reportInputFromDraft({
        ...INITIAL_REPORT_DRAFT,
        sourceKind: "customGraph",
        customGraphId: "g_9",
      });
      expect(out.source).toEqual({ kind: "customGraph", customGraphId: "g_9" });
    });
  });
});
