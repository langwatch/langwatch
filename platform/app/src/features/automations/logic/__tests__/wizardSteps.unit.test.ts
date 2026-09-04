import { describe, expect, it } from "vitest";
import type { EmailSlice } from "~/features/automations/providers/email/client";
import { CLIENT_PROVIDERS } from "~/features/automations/providers/registry";
import { TriggerAction } from "~/generated/prisma/client";
import { type AutomationDraft, INITIAL_DRAFT } from "../draftReducer";
import {
  nextStep,
  previousStep,
  stepIsComplete,
  stepIsReachable,
  stepSummary,
} from "../wizardSteps";

const emailWith = (members: string[]): EmailSlice => ({
  ...(CLIENT_PROVIDERS[
    TriggerAction.SEND_EMAIL
  ].client.initialSlice() as EmailSlice),
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

const graphDraft: AutomationDraft = {
  ...filterDraft,
  source: "customGraph",
  filterQuery: null,
  customGraphId: "graph-1",
  graphAlert: {
    seriesName: "0/latency/p95",
    operator: "gt",
    threshold: 250,
    timePeriod: 60,
  },
};

describe("wizard step order", () => {
  describe("given the first step", () => {
    it("walks forward to delivery and has nothing before it", () => {
      expect(nextStep("watch")).toBe("delivery");
      expect(previousStep("watch")).toBeNull();
    });
  });

  describe("given the last step", () => {
    it("has nothing after it and walks back to delivery", () => {
      expect(nextStep("review")).toBeNull();
      expect(previousStep("review")).toBe("delivery");
    });
  });
});

describe("stepIsReachable", () => {
  describe("when the author has only reached the watch step", () => {
    it("keeps later steps out of reach", () => {
      expect(stepIsReachable({ step: "watch", furthestStep: "watch" })).toBe(
        true,
      );
      expect(stepIsReachable({ step: "delivery", furthestStep: "watch" })).toBe(
        false,
      );
    });
  });

  describe("when the author has reached the review step", () => {
    it("leaves every earlier step one click away", () => {
      expect(stepIsReachable({ step: "watch", furthestStep: "review" })).toBe(
        true,
      );
      expect(
        stepIsReachable({ step: "delivery", furthestStep: "review" }),
      ).toBe(true);
    });
  });
});

describe("stepIsComplete", () => {
  describe("when the automation watches a trace filter", () => {
    it("needs a condition before the watch step is answered", () => {
      expect(stepIsComplete({ step: "watch", draft: filterDraft })).toBe(true);
      expect(
        stepIsComplete({
          step: "watch",
          draft: { ...filterDraft, filterQuery: null },
        }),
      ).toBe(false);
    });
  });

  describe("when the automation watches a graph", () => {
    it("needs the graph, the series, and the threshold rule", () => {
      expect(stepIsComplete({ step: "watch", draft: graphDraft })).toBe(true);
      expect(
        stepIsComplete({
          step: "watch",
          draft: { ...graphDraft, customGraphId: null },
        }),
      ).toBe(false);
      expect(
        stepIsComplete({
          step: "watch",
          draft: {
            ...graphDraft,
            graphAlert: { ...graphDraft.graphAlert, threshold: NaN },
          },
        }),
      ).toBe(false);
    });
  });

  describe("when the delivery channel is half configured", () => {
    it("reads as incomplete until the channel setup is finished", () => {
      expect(stepIsComplete({ step: "delivery", draft: filterDraft })).toBe(
        true,
      );
      expect(
        stepIsComplete({
          step: "delivery",
          draft: {
            ...filterDraft,
            slices: {
              ...filterDraft.slices,
              [TriggerAction.SEND_EMAIL]: emailWith([]),
            },
          },
        }),
      ).toBe(false);
    });
  });

  describe("when the automation has no name", () => {
    it("leaves the review step incomplete", () => {
      expect(stepIsComplete({ step: "review", draft: filterDraft })).toBe(true);
      expect(
        stepIsComplete({
          step: "review",
          draft: { ...filterDraft, name: "  " },
        }),
      ).toBe(false);
    });
  });

  describe("when the automation is named but an earlier step is unanswered", () => {
    /** @scenario "The review step is only marked answered once the earlier steps are" */
    it("leaves the review step incomplete until the watch step is answered", () => {
      expect(
        stepIsComplete({
          step: "review",
          draft: { ...filterDraft, filterQuery: "" },
        }),
      ).toBe(false);
    });

    /** @scenario "The review step is only marked answered once the earlier steps are" */
    it("leaves the review step incomplete until the delivery is set up", () => {
      expect(
        stepIsComplete({
          step: "review",
          draft: {
            ...filterDraft,
            slices: {
              ...filterDraft.slices,
              [TriggerAction.SEND_EMAIL]: emailWith([]),
            },
          },
        }),
      ).toBe(false);
    });
  });
});

describe("stepSummary", () => {
  describe("when the automation watches a trace filter", () => {
    it("names the filter and the query it matches", () => {
      expect(stepSummary({ step: "watch", draft: filterDraft })).toBe(
        "Trace filter · status:error",
      );
    });
  });

  describe("when the automation watches a graph", () => {
    it("names the graph once its row has loaded", () => {
      expect(
        stepSummary({ step: "watch", draft: graphDraft, graphName: "Latency" }),
      ).toBe("Graph · Latency");
      expect(stepSummary({ step: "watch", draft: graphDraft })).toBe("Graph");
    });
  });

  describe("when nothing is watched yet", () => {
    it("has nothing to summarise", () => {
      expect(stepSummary({ step: "watch", draft: INITIAL_DRAFT })).toBeNull();
      expect(
        stepSummary({ step: "delivery", draft: INITIAL_DRAFT }),
      ).toBeNull();
    });
  });

  describe("when a trace automation delivers on a digest cadence", () => {
    it("says where it goes and how often", () => {
      const summary = stepSummary({
        step: "delivery",
        draft: { ...filterDraft, notificationCadence: "5min_digest" },
      });
      expect(summary).toMatch(/email to 1 recipient/);
      expect(summary).toMatch(/Every 5 minutes/);
    });
  });

  describe("when a graph automation delivers", () => {
    it("says only where it goes — the server pins its cadence", () => {
      expect(stepSummary({ step: "delivery", draft: graphDraft })).toMatch(
        /email to 1 recipient/,
      );
      expect(stepSummary({ step: "delivery", draft: graphDraft })).not.toMatch(
        /Every 5 minutes/,
      );
    });
  });
});
