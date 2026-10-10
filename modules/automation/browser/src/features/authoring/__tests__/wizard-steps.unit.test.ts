import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  findNextStep,
  findPreviousStep,
  stepIsComplete,
  stepIsReachable,
  stepSummary,
} from "../model/wizard-steps.ts";
import { CLIENT_PROVIDERS } from "../ui/sections/client-providers.ts";
import {
  type AutomationDraft,
  type GraphAlertDraft,
  INITIAL_DRAFT,
} from "../ui/sections/draft-model.ts";
import emailClient, { type EmailSlice } from "../ui/sections/email.client.tsx";

const registry = CLIENT_PROVIDERS;

const emailWith = (members: string[]): EmailSlice => ({
  ...emailClient.initialSlice(),
  members,
});

const filterDraft: AutomationDraft = {
  ...INITIAL_DRAFT,
  name: "Flag failures",
  action: TriggerAction.SEND_EMAIL,
  filterQuery: "status:error",
  notificationCadence: "immediate",
  slices: {
    ...INITIAL_DRAFT.slices,
    [TriggerAction.SEND_EMAIL]: emailWith(["ops@acme.test"]),
  },
};

const graphAlert: GraphAlertDraft = {
  seriesName: "0/latency/p95",
  operator: "gt",
  threshold: 250,
  timePeriod: 60,
};

const graphDraft: AutomationDraft = {
  ...filterDraft,
  source: "customGraph",
  filterQuery: null,
  customGraphId: "graph-1",
  graphAlert,
};

const noRecipients: AutomationDraft = {
  ...filterDraft,
  slices: { ...filterDraft.slices, [TriggerAction.SEND_EMAIL]: emailWith([]) },
};

describe("wizard step order", () => {
  describe("given the first step", () => {
    it("walks forward to delivery and has nothing before it", () => {
      expect(findNextStep("watch")).toEqual(["delivery"]);
      expect(findPreviousStep("watch")).toEqual([]);
    });
  });

  describe("given the last step", () => {
    it("has nothing after it and walks back to delivery", () => {
      expect(findNextStep("review")).toEqual([]);
      expect(findPreviousStep("review")).toEqual(["delivery"]);
    });
  });
});

describe("stepIsReachable", () => {
  describe("when the author has only reached the watch step", () => {
    it("keeps later steps out of reach", () => {
      expect(stepIsReachable({ step: "watch", furthestStep: "watch" })).toBe(true);
      expect(stepIsReachable({ step: "delivery", furthestStep: "watch" })).toBe(false);
    });
  });

  describe("when the author has reached the review step", () => {
    it("leaves every earlier step one click away", () => {
      expect(stepIsReachable({ step: "watch", furthestStep: "review" })).toBe(true);
      expect(stepIsReachable({ step: "delivery", furthestStep: "review" })).toBe(true);
    });
  });
});

describe("stepIsComplete", () => {
  describe("when the automation watches a trace filter", () => {
    it("needs a condition before the watch step is answered", () => {
      expect(stepIsComplete({ step: "watch", draft: filterDraft, registry })).toBe(true);
      expect(
        stepIsComplete({ step: "watch", draft: { ...filterDraft, filterQuery: null }, registry }),
      ).toBe(false);
    });
  });

  describe("when the automation watches a graph", () => {
    it("needs the graph, the series, and the threshold rule", () => {
      expect(stepIsComplete({ step: "watch", draft: graphDraft, registry })).toBe(true);
      expect(
        stepIsComplete({ step: "watch", draft: { ...graphDraft, customGraphId: null }, registry }),
      ).toBe(false);
      expect(
        stepIsComplete({
          step: "watch",
          draft: { ...graphDraft, graphAlert: { ...graphAlert, threshold: NaN } },
          registry,
        }),
      ).toBe(false);
    });
  });

  describe("when the delivery channel is half configured", () => {
    it("reads as incomplete until the channel setup is finished", () => {
      expect(stepIsComplete({ step: "delivery", draft: filterDraft, registry })).toBe(true);
      expect(stepIsComplete({ step: "delivery", draft: noRecipients, registry })).toBe(false);
    });
  });

  describe("when the automation has no name", () => {
    it("leaves the review step incomplete", () => {
      expect(stepIsComplete({ step: "review", draft: filterDraft, registry })).toBe(true);
      expect(
        stepIsComplete({ step: "review", draft: { ...filterDraft, name: "  " }, registry }),
      ).toBe(false);
    });
  });

  describe("when the automation is named but an earlier step is unanswered", () => {
    /** @scenario "The review step is only marked answered once the earlier steps are" */
    it("leaves the review step incomplete until the watch step is answered", () => {
      expect(
        stepIsComplete({ step: "review", draft: { ...filterDraft, filterQuery: "" }, registry }),
      ).toBe(false);
    });

    /** @scenario "The review step is only marked answered once the earlier steps are" */
    it("leaves the review step incomplete until the delivery is set up", () => {
      expect(stepIsComplete({ step: "review", draft: noRecipients, registry })).toBe(false);
    });
  });
});

describe("stepSummary", () => {
  describe("when the automation watches a trace filter", () => {
    it("names the filter and the query it matches", () => {
      expect(stepSummary({ step: "watch", draft: filterDraft, registry })).toBe(
        "Trace filter · status:error",
      );
    });
  });

  describe("when the automation watches a graph", () => {
    it("names the graph once its row has loaded", () => {
      expect(
        stepSummary({ step: "watch", draft: graphDraft, registry, graphName: "Latency" }),
      ).toBe("Graph · Latency");
      expect(stepSummary({ step: "watch", draft: graphDraft, registry })).toBe("Graph");
    });
  });

  describe("when nothing is watched yet", () => {
    it("has nothing to summarise", () => {
      expect(stepSummary({ step: "watch", draft: INITIAL_DRAFT, registry })).toBe("");
      expect(stepSummary({ step: "delivery", draft: INITIAL_DRAFT, registry })).toBe("");
    });
  });

  describe("when a trace automation delivers on a digest cadence", () => {
    it("says where it goes and how often", () => {
      const summary = stepSummary({
        step: "delivery",
        draft: { ...filterDraft, notificationCadence: "5min_digest" },
        registry,
      });
      expect(summary).toMatch(/email to 1 recipient/);
      expect(summary).toMatch(/Every 5 minutes/);
    });
  });

  describe("when a graph automation delivers", () => {
    it("says only where it goes, since the server pins its cadence", () => {
      const summary = stepSummary({ step: "delivery", draft: graphDraft, registry });
      expect(summary).toMatch(/email to 1 recipient/);
      expect(summary).not.toMatch(/Every 5 minutes/);
    });
  });
});
