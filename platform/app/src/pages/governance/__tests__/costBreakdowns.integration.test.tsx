/**
 * @vitest-environment jsdom
 *
 * The breakdown panels under the cost lanes, mounted through the real page.
 *
 * Two things are under test, and both are about what the screen is allowed to
 * claim. First, the panels have to survive a real answer: the activity reads
 * hand back a wrapper object, not a list, and a panel that maps over the
 * wrapper throws the instant real data arrives — which no test caught, because
 * every existing mock answers `undefined`. Second, a panel that has not heard
 * back must not print a figure: "0 users" and "nothing in this window" are both
 * measurements, and neither has been made while a read is still in flight or
 * was never permitted to run.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** What each activity read answers. `undefined` means it has not answered. */
  activity: {
    summary: undefined as unknown,
    spendByDepartment: undefined as unknown,
    spendByUser: undefined as unknown,
    spendOverTime: undefined as unknown,
  },
  /**
   * The ranked model read's answer. `undefined` means it has not answered.
   *
   * On the billed router rather than the activity monitor: this panel reads
   * the same rollup the lanes above it read, which is where pulled bills land.
   * Pointed at the metered traces it reported an empty window over a table
   * that held every model the organization had been billed for.
   */
  modelSpend: undefined as unknown,
  modelSpendFails: false,
  /** The spender breakdown read: its answer, whether it failed, retry spy. */
  spenders: {
    data: undefined as unknown,
    isError: false,
    refetch: undefined as unknown,
  },
  /**
   * The cost summary's lanes: whether any source is reporting a figure.
   *
   * Configurable because this is the screen's signal for whether anything is
   * connected at all, and the adoption headcount cannot state its own absence
   * — see the "count that cannot state its own absence" section of the spec.
   *
   * Lanes rather than `unavailableReason`, because the organization the defect
   * was reported on has neither structural reason set: it has a cost store and
   * a governance project, and simply nothing flowing through them. Keying the
   * fixture on the reason alone would have reproduced a case the live screen
   * was not in. Defaults to reporting, which is what every test here assumed
   * before it was a variable.
   */
  lanesReport: true,
  /**
   * The billed lane's per-provider window totals, as the summary read answers
   * them. Empty by default: the provider panel is not what most of this file
   * is about, and an empty list renders nothing.
   */
  providers: [] as unknown[],
  /**
   * Not yet implemented: the per-(day, provider) read. It is the one thing the
   * screen could never answer — it could say what a provider cost over a
   * quarter and what the organization spent on a given day, and had no way to
   * say which provider caused a day that stood out.
   */
  dailyByProvider: undefined as unknown,
  /** Not yet implemented: the records behind one day at one provider. */
  periodRecords: undefined as unknown,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));
vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));
vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));
vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/utils/api", () => ({
  api: {
    governanceCost: {
      spendByModel: {
        useQuery: () => ({
          data: harness.modelSpend,
          isLoading: false,
          isError: harness.modelSpendFails,
        }),
      },
      spenders: {
        useQuery: () => ({
          data: harness.spenders.data,
          isError: harness.spenders.isError,
          refetch: harness.spenders.refetch,
        }),
      },
      dailyByProvider: {
        useQuery: () => ({
          data: harness.dailyByProvider,
          isLoading: false,
          isError: false,
        }),
      },
      periodRecords: {
        useQuery: () => ({
          data: harness.periodRecords,
          isLoading: false,
          isError: false,
        }),
      },
      summary: {
        useQuery: () => ({
          data: {
            unavailableReason: null,
            providers: harness.providers,
            billed: harness.lanesReport
              ? { amountUsd: 123.45, cellsWithoutAmount: 0 }
              : { amountUsd: null, cellsWithoutAmount: 0 },
            gateway: harness.lanesReport
              ? { amountUsd: 67.89, cellsWithoutAmount: 0 }
              : { amountUsd: null, cellsWithoutAmount: 0 },
            seats: { status: "awaiting_data" },
            series: harness.lanesReport
              ? [{ day: "2026-08-01", billedUsd: 123.45, gatewayUsd: 67.89 }]
              : [],
            windowDays: 30,
          },
          isLoading: false,
          isError: false,
        }),
      },
    },
    activityMonitor: {
      summary: { useQuery: () => ({ data: harness.activity.summary }) },
      spendByDepartment: {
        useQuery: () => ({ data: harness.activity.spendByDepartment }),
      },
      spendByUser: {
        useQuery: () => ({ data: harness.activity.spendByUser }),
      },
      spendOverTime: {
        useQuery: () => ({ data: harness.activity.spendOverTime }),
      },
    },
  },
}));

import CostsPage from "../costs";

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CostsPage />
    </ChakraProvider>,
  );

beforeEach(() => {
  harness.activity = {
    summary: undefined,
    spendByDepartment: undefined,
    spendByUser: undefined,
    spendOverTime: undefined,
  };
  harness.spenders = { data: undefined, isError: false, refetch: vi.fn() };
  harness.lanesReport = true;
  harness.providers = [];
  harness.dailyByProvider = undefined;
  harness.periodRecords = undefined;
  harness.modelSpend = undefined;
  harness.modelSpendFails = false;
});

afterEach(() => cleanup());

describe("the cost breakdown panels", () => {
  describe("given the activity reads answer with real figures", () => {
    beforeEach(() => {
      harness.activity.summary = {
        activeUsersThisWindow: 42,
        newUsersThisWindow: 3,
        spentThisWindowUsd: "500.00",
      };
      harness.activity.spendByDepartment = [
        {
          departmentId: "dep-1",
          departmentName: "Engineering",
          spendUsd: "310.50",
        },
        {
          departmentId: "dep-2",
          departmentName: "Support",
          spendUsd: "120.25",
        },
      ];
      harness.activity.spendByUser = [
        { actor: "ada@acme.test", spendUsd: "200.00", requests: 90 },
      ];
      // The read answers a wrapper around the buckets, not the buckets. A
      // panel that treats this as a list throws here rather than rendering.
      harness.activity.spendOverTime = {
        buckets: [
          {
            bucketIso: "2026-08-01",
            points: [
              { key: "team-a", label: "Team A", spendUsd: "310.50" },
              { key: "team-b", label: "Team B", spendUsd: "120.25" },
            ],
          },
        ],
      };
    });

    it("renders the real breakdowns instead of throwing on the wrapper", () => {
      renderScreen();

      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText("Support")).toBeInTheDocument();
      expect(screen.getByText("ada@acme.test")).toBeInTheDocument();
    });

    it("reports the measured user count", () => {
      renderScreen();

      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("never claims a real panel is empty while it holds figures", () => {
      renderScreen();

      expect(screen.queryByText("Not available.")).not.toBeInTheDocument();
    });
  });

  describe("given billed spend recorded against two models", () => {
    /** @scenario "The ranked model panel fills from the billed lane" */
    it("names both models and does not say the window holds nothing", () => {
      // The activity reads stay silent on purpose: this panel must fill from
      // the billed rollup alone. Pointed at the metered traces it reported an
      // empty window over a table holding every model that had been billed.
      harness.modelSpend = {
        unavailableReason: null,
        rows: [
          { model: "claude-opus-5", amountUsd: 34.95, cellsWithoutAmount: 0 },
          {
            model: "gpt-5-mini-2025-08-07, output",
            amountUsd: 4.34,
            cellsWithoutAmount: 0,
          },
        ],
        windowDays: 30,
      };

      renderScreen();

      const panel = screen
        .getByText("Cost by model")
        .closest('[data-testid="cost-panel"]');
      expect(panel).not.toBeNull();
      const models = within(panel as HTMLElement);

      expect(models.getByText("claude-opus-5")).toBeInTheDocument();
      // The line item verbatim: OpenAI bills per token kind and the puller
      // stores that unsplit, so re-cutting it anywhere would invent a
      // grouping the invoice does not make.
      expect(
        models.getByText("gpt-5-mini-2025-08-07, output"),
      ).toBeInTheDocument();
      expect(
        models.queryByText("Nothing in this window yet."),
      ).not.toBeInTheDocument();
    });
  });

  describe("given billed spend recorded against a priced model and an unpriced one", () => {
    /** @scenario "A model the screen cannot price is listed without a figure" */
    it("lists both and shows no number for the one it cannot price", () => {
      // The panel used to drop the unpriced model. Dropping it reports a
      // smaller bill than the provider sent, and a window whose models were
      // all unpriced emptied the panel into a measurement claim.
      harness.modelSpend = {
        unavailableReason: null,
        rows: [
          { model: "claude-opus-5", amountUsd: 34.95, cellsWithoutAmount: 0 },
          {
            model: "claude-sonnet-5",
            amountUsd: null,
            cellsWithoutAmount: 3,
          },
        ],
        windowDays: 30,
      };

      renderScreen();

      const panel = screen
        .getByText("Cost by model")
        .closest('[data-testid="cost-panel"]');
      expect(panel).not.toBeNull();
      const models = within(panel as HTMLElement);

      expect(models.getByText("claude-opus-5")).toBeInTheDocument();
      expect(models.getByText("claude-sonnet-5")).toBeInTheDocument();

      // No figure in its place, and the reason on hover rather than a zero
      // that would read as "this model cost nothing".
      const withheld = panel?.querySelector('[data-unpriced="true"]');
      expect(withheld).not.toBeNull();
      expect(withheld?.textContent).toBe("—");
      expect(withheld?.getAttribute("title")).toContain("unpriced");
      expect(withheld?.getAttribute("title")).toContain("3");
    });
  });

  describe("given an activity read has not answered", () => {
    it("says so rather than printing a zero nobody measured", () => {
      renderScreen();

      // The adoption card and every read-backed panel are unanswered here, so
      // the screen may not show "0" or claim the window held nothing.
      expect(screen.queryByText("0")).not.toBeInTheDocument();
      // SCOPED TO THE PANELS THAT HAVE A READ. The agent breakdowns and the
      // two count panels have none yet — they are drawn in both modes so the
      // screen keeps its shape when a reader turns samples off, and outside
      // sample mode they carry a stated placeholder. A page-wide search for
      // the sentence now finds theirs and says nothing about the panels this
      // is actually about.
      for (const title of [
        "Cost over time",
        "Cost by department",
        "Cost by model",
        "Metered spend by person",
      ]) {
        const panel = screen
          .getByText(title)
          .closest('[data-testid="cost-panel"]');
        expect(panel).not.toBeNull();
        expect(
          within(panel as HTMLElement).queryByText(
            "Nothing in this window yet.",
          ),
        ).not.toBeInTheDocument();
      }
    });

    /** @scenario "An empty panel says what it holds and what would fill it" */
    it("names what each empty panel holds and what would fill it", () => {
      renderScreen();

      // The sentence a panel used to show instead. It named neither the panel
      // nor what would fill it, so a reader's next move on seeing it was to
      // report a bug against a screen working exactly as designed.
      expect(screen.queryByText("Not available.")).not.toBeInTheDocument();
      expect(
        screen.getByText("Spend per model, largest first."),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(
          "Fills from the bills a connected source reports.",
        )[0],
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("link", { name: /Add a source/ }).length,
      ).toBeGreaterThan(0);
    });
  });

  describe("given an activity read answers with no rows", () => {
    it("reports the window as empty, which it measured", () => {
      harness.activity.summary = {
        activeUsersThisWindow: 0,
        newUsersThisWindow: 0,
        spentThisWindowUsd: "0",
      };
      harness.activity.spendByDepartment = [];
      harness.activity.spendByUser = [];
      harness.activity.spendOverTime = { buckets: [] };

      renderScreen();

      expect(
        screen.getAllByText("Nothing in this window yet.").length,
      ).toBeGreaterThan(0);
    });
  });

  /**
   * The adoption headcount is the one figure here that cannot say "unmeasured"
   * — the activity summary types it as a plain number and zero-fills it when
   * nothing is connected. So these two cases send the SAME zero and differ
   * only in whether a source is behind it, which is the whole rule.
   */
  describe("given the activity read answers zero active people", () => {
    beforeEach(() => {
      harness.activity.summary = {
        activeUsersThisWindow: 0,
        newUsersThisWindow: 0,
        spentThisWindowUsd: "0",
      };
      harness.activity.spendByDepartment = [];
      harness.activity.spendByUser = [];
      harness.activity.spendOverTime = { buckets: [] };
    });

    /** @scenario "An adoption count of zero from a connected source is shown as the measurement it is" */
    it("shows the zero when a source is connected, because a quiet window is a finding", () => {
      harness.lanesReport = true;

      renderScreen();

      const adoption = screen
        .getByText("People using AI tools")
        .closest("[data-testid='cost-panel']");
      expect(adoption).not.toBeNull();
      expect(
        within(adoption as HTMLElement).getByText("0"),
      ).toBeInTheDocument();
      // An organization that already has a source must not be told to add one.
      expect(
        within(adoption as HTMLElement).queryByRole("link", {
          name: /Add a source/,
        }),
      ).not.toBeInTheDocument();
    });

    /** @scenario "An adoption count of zero with nothing connected is not reported as a measurement" */
    it("withholds the same zero when nothing is connected, and names what would fill it", async () => {
      harness.lanesReport = false;

      renderScreen();

      const adoption = screen
        .getByText("Adoption")
        .closest("[data-testid='cost-panel']") as HTMLElement;
      // No headcount, and no label standing over a blank where one was.
      expect(within(adoption).queryByText("0")).not.toBeInTheDocument();
      expect(
        within(adoption).queryByText("People using AI tools"),
      ).not.toBeInTheDocument();
      expect(
        within(adoption).getByText(
          "How many people used an AI tool in this period.",
        ),
      ).toBeInTheDocument();
      expect(
        within(adoption).getByText(
          "Fills from the activity a connected source reports.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("given the spender breakdown answers with rows", () => {
    beforeEach(() => {
      harness.spenders.data = {
        rows: [
          {
            provider: "openai_admin",
            rawActorId: "u_ada",
            label: "ada@acme.test",
            agentId: "",
            amountUsd: 4,
            cellsWithoutAmount: 0,
          },
          {
            provider: "databricks",
            rawActorId: "ada@acme.test",
            label: "ada@acme.test",
            agentId: "",
            amountUsd: 6,
            cellsWithoutAmount: 0,
          },
          // Spend the provider attributed to no user. It is on
          // every real version of this list, so it is on this one.
          {
            provider: "",
            rawActorId: "",
            label: null,
            agentId: "",
            amountUsd: 3,
            cellsWithoutAmount: 0,
          },
        ],
        windowDays: 30,
      };
    });

    it("names each row's provider, so one user reported at two providers is not a duplicate", () => {
      renderScreen();

      expect(screen.getByText("openai_admin")).toBeInTheDocument();
      expect(screen.getByText("databricks")).toBeInTheDocument();
    });

    /** @scenario "The provider-reported breakdown names users and keeps unattributed spend" */
    it("labels the returned users without presenting them as API keys", () => {
      renderScreen();

      expect(
        screen.getByText("Provider-reported spend by user"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Billed spend by API key"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Unattributed spend")).toBeInTheDocument();
      expect(screen.getByText("Metered spend by person")).toBeInTheDocument();
    });
  });

  describe("given the spender breakdown read fails", () => {
    beforeEach(() => {
      harness.spenders.isError = true;
    });

    it("says the read failed instead of vanishing as if nobody spent anything", () => {
      renderScreen();

      expect(
        screen.getByText("Provider-reported spend by user"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("cost-spenders-error")).toBeInTheDocument();
    });

    it("offers a retry that asks the read to run again", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(harness.spenders.refetch).toHaveBeenCalled();
    });
  });

  describe("given the window answers with days but nothing spent on any of them", () => {
    it("says the window is empty rather than drawing bare axes", () => {
      // The read answered and the window holds nothing. That is a FINDING and
      // the panel is allowed to say so — but it must say it in words, because
      // a time chart handed an answer with no series to plot draws an axis
      // with nothing above it, which reads as a chart that broke rather than
      // as a quarter nobody spent in.
      //
      // The panel under this name used to chart spend by team off the metered
      // trace store, and the case was a window of 365 empty buckets from a
      // read that answers a row per day whether or not anything was spent.
      // That read is gone. The billed rollup this now folds only ever answers
      // days it holds cells for, so the same case arrives as no rows at all —
      // and the assertion below is unchanged, which is the point of moving it
      // rather than deleting it.
      harness.activity.summary = {
        activeUsersThisWindow: 4,
        newUsersThisWindow: 1,
        spentThisWindowUsd: "0",
      };
      harness.activity.spendByDepartment = [
        {
          departmentId: "dep-1",
          departmentName: "Engineering",
          spendUsd: "410.00",
        },
      ];
      harness.activity.spendByUser = [
        { actor: "ada@acme.test", spendUsd: "200.00", requests: 90 },
      ];
      harness.dailyByProvider = { rows: [] };

      renderScreen();

      // Scoped to this panel on purpose. Other panels are empty for their own
      // reasons and print the same sentence, so a page-wide search for it
      // passes whether or not this panel drew bare axes.
      const panel = screen
        .getByText("Cost over time")
        .closest('[data-testid="cost-panel"]');

      expect(panel).not.toBeNull();
      expect(
        within(panel as HTMLElement).getByText("Nothing in this window yet."),
      ).toBeInTheDocument();
    });
  });

  describe("given two providers billed on the same days of the window", () => {
    /**
     * Distinct at every figure on purpose. With any two of them equal, an
     * implementation that mixed up a day, a provider or a total would still
     * satisfy the assertions below.
     */
    beforeEach(() => {
      harness.providers = [
        { provider: "openai_admin", amountUsd: 90, cellsWithoutAmount: 0 },
        { provider: "anthropic_admin", amountUsd: 62, cellsWithoutAmount: 0 },
      ];
      harness.dailyByProvider = {
        rows: [
          {
            day: "2026-01-15",
            provider: "openai_admin",
            amountUsd: 60,
            cellsWithoutAmount: 0,
          },
          {
            day: "2026-01-15",
            provider: "anthropic_admin",
            amountUsd: 41,
            cellsWithoutAmount: 0,
          },
          {
            day: "2026-01-16",
            provider: "openai_admin",
            amountUsd: 30,
            cellsWithoutAmount: 0,
          },
          {
            day: "2026-01-16",
            provider: "anthropic_admin",
            amountUsd: 21,
            cellsWithoutAmount: 0,
          },
        ],
      };
    });

    /**
     * The panel keeps its place in the grid and says whose spend it is.
     *
     * WHAT IT DRAWS IS NOT CHECKED HERE. It is a chart now, and a chart draws
     * nothing under a renderer with no layout: its container measures zero
     * and recharts declines to plot into it. The arithmetic behind the bars —
     * the split per period, the span each bar covers — is checked directly in
     * `src/components/governance/costs/__tests__/providerPeriods.unit.test.ts`,
     * where it can be.
     */
    it("renders under its own heading beside the lane it splits", () => {
      renderScreen();

      expect(
        screen.getByLabelText("Cost over time · by provider"),
      ).toBeInTheDocument();
      // Its neighbour still states the window total the bars split up, so a
      // reader has both halves of the comparison on one screen.
      const billed = within(screen.getByTestId("cost-lane-billed"));
      expect(billed.getByText("$90.00")).toBeInTheDocument();
      expect(billed.getByText("$62.00")).toBeInTheDocument();
    });
  });

  describe("given one provider holds a day we have no dollar figure for", () => {
    /** @scenario "A provider holding a period with no dollar figure shows no window total" */
    it("shows that provider no window total and marks its bars as covering only part of the spend", () => {
      harness.providers = [
        { provider: "openai_admin", amountUsd: 90, cellsWithoutAmount: 0 },
        // The window total is withheld: one of its days holds no figure, so
        // adding up the rest would understate what the provider charged.
        { provider: "anthropic_admin", amountUsd: null, cellsWithoutAmount: 1 },
      ];
      harness.dailyByProvider = {
        rows: [
          {
            day: "2026-01-15",
            provider: "anthropic_admin",
            amountUsd: 41,
            cellsWithoutAmount: 0,
          },
          {
            day: "2026-01-16",
            provider: "anthropic_admin",
            amountUsd: null,
            cellsWithoutAmount: 1,
          },
        ],
      };
      renderScreen();

      const billed = within(screen.getByTestId("cost-lane-billed"));
      expect(billed.getByText("Anthropic")).toBeInTheDocument();
      expect(billed.getByText("USD amount unavailable")).toBeInTheDocument();

      // Its other days each hold a real number, so a reader who adds the bars
      // up rebuilds exactly the partial sum the window total refused to show
      // them. The mark on the bars is what stops the chart from being that
      // sum.
      const region = within(
        screen.getByLabelText("Cost over time · by provider"),
      );
      expect(
        region.getByLabelText(/cover only part of what was spent/i),
      ).toBeInTheDocument();
      // And it names WHICH provider is short, because the chart stacks two of
      // them and a bare caveat leaves a reader unable to tell which bar to
      // distrust.
      expect(region.getByText(/Anthropic/)).toBeInTheDocument();
    });
  });
});
