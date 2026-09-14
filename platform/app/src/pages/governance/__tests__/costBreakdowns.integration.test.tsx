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
  /**
   * The cost summary's per-day series, when a test needs one of its own.
   *
   * `undefined` leaves the dollars-only default below in place. Set it when a
   * test needs days that carry a token figure as well as a dollar one: the
   * token panels have no read of their own and fold this same series.
   */
  series: undefined as unknown,
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
            // In the DTO's own shape: the US dollar line IS the lane's dollar
            // figure, and a lane that reported nothing has no line at all.
            billed: harness.lanesReport
              ? {
                  amountUsd: 123.45,
                  cellsWithoutAmount: 0,
                  currenciesWithoutUsdAmount: [],
                  currencyTotals: [
                    {
                      currencyCode: "USD",
                      amount: 123.45,
                      cellsWithoutAmount: 0,
                    },
                  ],
                }
              : {
                  amountUsd: null,
                  cellsWithoutAmount: 0,
                  currenciesWithoutUsdAmount: [],
                  currencyTotals: [],
                },
            gateway: harness.lanesReport
              ? {
                  amountUsd: 67.89,
                  cellsWithoutAmount: 0,
                  currenciesWithoutUsdAmount: [],
                  currencyTotals: [
                    {
                      currencyCode: "USD",
                      amount: 67.89,
                      cellsWithoutAmount: 0,
                    },
                  ],
                }
              : {
                  amountUsd: null,
                  cellsWithoutAmount: 0,
                  currenciesWithoutUsdAmount: [],
                  currencyTotals: [],
                },
            seats: { status: "awaiting_data" },
            series:
              harness.series ??
              (harness.lanesReport
                ? [{ day: "2026-08-01", billedUsd: 123.45, gatewayUsd: 67.89 }]
                : []),
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
  harness.series = undefined;
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
        "Tokens by person · trace store",
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
      expect(
        screen.getByText("Tokens by person · trace store"),
      ).toBeInTheDocument();
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
            currenciesWithoutUsdAmount: [],
          },
          {
            day: "2026-01-15",
            provider: "anthropic_admin",
            amountUsd: 41,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
          },
          {
            day: "2026-01-16",
            provider: "openai_admin",
            amountUsd: 30,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
          },
          {
            day: "2026-01-16",
            provider: "anthropic_admin",
            amountUsd: 21,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
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
            currenciesWithoutUsdAmount: [],
          },
          {
            day: "2026-01-16",
            provider: "anthropic_admin",
            amountUsd: null,
            cellsWithoutAmount: 1,
            currenciesWithoutUsdAmount: [],
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

  describe("given the window holds a day we have no dollar figure for", () => {
    /** @scenario "A day with a withheld amount shows as withheld in cost over time, not as a smaller bar" */
    it("marks the cost-over-time chart as short and names the provider that withheld", () => {
      harness.providers = [
        { provider: "openai_admin", amountUsd: 90, cellsWithoutAmount: 0 },
        { provider: "anthropic_admin", amountUsd: null, cellsWithoutAmount: 1 },
      ];
      harness.dailyByProvider = {
        rows: [
          {
            day: "2026-01-15",
            provider: "openai_admin",
            amountUsd: 90,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
          },
          {
            day: "2026-01-16",
            provider: "anthropic_admin",
            amountUsd: null,
            cellsWithoutAmount: 1,
            currenciesWithoutUsdAmount: [],
          },
        ],
      };
      renderScreen();

      // Scoped to THIS panel: the provider split beside it carries the same
      // note for the same rows, and a page-wide search would pass on that one
      // while the total chart stayed silent — which is the bug.
      const panel = screen
        .getByText("Cost over time")
        .closest('[data-testid="cost-panel"]');
      expect(panel).not.toBeNull();
      const region = within(panel as HTMLElement);
      const note = region.getByLabelText(/cover only part of what was spent/i);
      // Names WHO withheld, so a reader knows which bill to go and look at.
      expect(note).toHaveTextContent(/Anthropic/);
      expect(note).not.toHaveTextContent(/OpenAI/);
    });
  });

  describe("given one provider billed in two currencies on the same day", () => {
    /**
     * The day holds a dollar bill and a euro bill, and only the dollars were
     * ever published in dollars. That is a different shape from the case above
     * and the screen currently cannot tell them apart.
     *
     * The figure here is NOT null and the cell count is NOT one: the euro cell
     * holds a real amount, in euros, so the rule that asks whether a cell holds
     * money in any currency at all is satisfied and counts nothing. Every mark
     * the panel has is keyed off those two values, so the day renders as a
     * plain complete figure that silently omits the euros.
     *
     * The lane headline one level up already says which currency it left out.
     * This is the same sentence, at the level where a reader actually compares
     * one provider against another.
     */
    /** @scenario "A provider billed in two currencies says which one its figure leaves out" */
    it("names the currency its figure leaves out", () => {
      harness.providers = [
        { provider: "anthropic_admin", amountUsd: 41, cellsWithoutAmount: 0 },
      ];
      harness.dailyByProvider = {
        rows: [
          {
            day: "2026-01-15",
            provider: "anthropic_admin",
            amountUsd: 41,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: ["EUR"],
          },
        ],
      };
      renderScreen();

      const region = within(
        screen.getByLabelText("Cost over time · by provider"),
      );
      const note = region.getByLabelText(/cover only part of what was spent/i);
      expect(note).toHaveTextContent(/Anthropic/);
      expect(note).toHaveTextContent(/EUR/);
    });
  });

  /**
   * TOKENS ON THE PANELS THAT COUNT PEOPLE, AND ON THE LANE THAT METERS THEM.
   *
   * Money answers "what did this cost", which is the wrong question for an
   * organization buying assistants on subscription: the per-request cost of a
   * bundled seat is zero, so a department of heavy subscription users reads as
   * nearly free. ADR-128 v3.17 ruling 7, narrowed by v3.18, moves these panels
   * onto tokens and keeps the dollar figure beside them rather than dropping
   * it.
   *
   * THE DOM CONTRACT THESE TESTS ASSERT ON. "Leads with" and "shown beneath"
   * are claims about order, and order is not observable through text alone —
   * a panel that printed tokens somewhere and dollars somewhere else would
   * satisfy any text-only assertion while failing the requirement. So each
   * ranked row exposes `data-rank-row="<key>"` with `[data-rank-lead]` and
   * `[data-rank-secondary]` inside it. That is a contract the implementation
   * has to honour, and it is the same shape as the `data-unpriced="true"`
   * hook the withheld-model case above already relies on.
   *
   * Spec: specs/governance/governance-cost-screen.feature, the rules
   * "One word, one number", "A people panel measures tokens and says which
   * store it read", and "Adoption counts the people of the whole
   * organization".
   */
  describe("the token figures", () => {
    /** Every panel card currently on the screen. */
    const allPanels = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="cost-panel"]'),
      );

    /** The panel card a piece of visible text sits inside. */
    const panelHolding = (text: string | RegExp): HTMLElement => {
      const panel = screen
        .getByText(text)
        .closest('[data-testid="cost-panel"]');
      // biome-ignore lint/suspicious/noMisplacedAssertion: this helper narrows the lookup to a panel for every caller, so the check belongs with the narrowing
      expect(panel, `no panel holds ${String(text)}`).not.toBeNull();
      return panel as HTMLElement;
    };

    /** A panel's ranked rows, in the order the panel draws them. */
    const rankRows = (panel: HTMLElement) =>
      Array.from(panel.querySelectorAll<HTMLElement>("[data-rank-row]"));

    const rowFor = (panel: HTMLElement, key: string): HTMLElement => {
      const row = panel.querySelector<HTMLElement>(`[data-rank-row="${key}"]`);
      // biome-ignore lint/suspicious/noMisplacedAssertion: this helper narrows the lookup to a row for every caller, so the check belongs with the narrowing
      expect(row, `the panel draws no ranked row for ${key}`).not.toBeNull();
      return row as HTMLElement;
    };

    /** The figure a row leads with — the one a reader compares rows by. */
    const lead = (row: HTMLElement): string => {
      const el = row.querySelector<HTMLElement>("[data-rank-lead]");
      // biome-ignore lint/suspicious/noMisplacedAssertion: this helper narrows the lookup to a lead figure for every caller, so the check belongs with the narrowing
      expect(el, `${row.dataset.rankRow} states no lead figure`).not.toBeNull();
      return (el as HTMLElement).textContent ?? "";
    };

    /** The second line beneath the lead figure, if the row draws one. */
    const secondary = (row: HTMLElement): string =>
      row.querySelector<HTMLElement>("[data-rank-secondary]")?.textContent ??
      "";

    /** A window of days that each carry a token count as well as dollars. */
    const TOKEN_SERIES = [
      {
        day: "2026-08-01",
        billedUsd: 12.5,
        gatewayUsd: 4.5,
        gatewayTokens: 900_000,
      },
      {
        day: "2026-08-02",
        billedUsd: 31.0,
        gatewayUsd: 9.25,
        gatewayTokens: 2_400_000,
      },
      {
        day: "2026-08-03",
        billedUsd: 8.75,
        gatewayUsd: 1.75,
        gatewayTokens: 310_000,
      },
    ];

    describe("given the gateway metered tokens across the window", () => {
      beforeEach(() => {
        harness.series = TOKEN_SERIES;
      });

      /** @scenario "Tokens over time draws the metered lane instead of standing empty" */
      it("draws the tokens those requests used rather than reporting an empty window", () => {
        // The panel folds the same summary series the dollar lanes fold, so a
        // window with token-bearing days has nothing left to wait for. Today
        // it is handed `AWAITING_A_READ` — the empty array declared at
        // costs.tsx:1123 and passed at :1627 — whatever the read answered, so
        // it prints a measurement of an empty window it never made.
        renderScreen();

        const tokens = panelHolding("Tokens over time");
        expect(
          within(tokens).queryByText("Nothing in this window yet."),
        ).not.toBeInTheDocument();
        expect(
          within(tokens).queryByText("Not available."),
        ).not.toBeInTheDocument();
      });
    });

    describe("given a window whose every request was metered in audio duration alone", () => {
      beforeEach(() => {
        // Speech is billed by duration, not by tokens. `AudioMS` is one of the
        // three metering columns that are not tokens at all (ADR-128 v3.18),
        // so these days carry real dollars and a true token count of zero.
        harness.series = [
          {
            day: "2026-08-01",
            billedUsd: 0,
            gatewayUsd: 21.5,
            gatewayTokens: 0,
          },
          {
            day: "2026-08-02",
            billedUsd: 0,
            gatewayUsd: 46.39,
            gatewayTokens: 0,
          },
        ];
      });

      /** @scenario "A window of speech reports no tokens and still reports its cost" */
      it("reports the zero it measured and keeps the metered lane's dollar figure", () => {
        // Tokens are blind to speech the way dollars are blind to
        // subscriptions. Both lanes stay on the screen so neither blind spot
        // is the only view — and the token panel reports the zero rather than
        // the empty-window sentence, because a window of speech was measured
        // and came to zero. That is a different state from the department row
        // with no token rows at all, which says it was not measured.
        renderScreen();

        const tokens = panelHolding("Tokens over time");

        // THE ZERO IS ASSERTED AS THE PANEL'S STATE, NOT AS A RENDERED "0".
        // The panel is a chart, and a chart draws nothing under a renderer
        // with no layout — recharts declines to plot into a container that
        // measures zero, the same reason the provider-split case above checks
        // its heading rather than its bars. What IS observable is which of the
        // two states the panel is in: today it is in the empty state and can
        // never be in the other one, because it is handed `AWAITING_A_READ`
        // (costs.tsx:1123, passed at :1627) whatever the read answered.
        expect(
          within(tokens).queryByTestId("cost-panel-empty"),
        ).not.toBeInTheDocument();
        expect(
          within(tokens).queryByText("Nothing in this window yet."),
        ).not.toBeInTheDocument();
        expect(
          within(tokens).queryByText("Not available."),
        ).not.toBeInTheDocument();
        // Zero is a count the screen made. "Not measured" is the wording
        // reserved for the rows it could not count at all.
        expect(tokens.textContent ?? "").not.toMatch(/not measured/i);

        // And the money the speech cost is still on the screen beside it.
        const gateway = within(screen.getByTestId("cost-lane-gateway"));
        expect(gateway.getByText("$67.89")).toBeInTheDocument();
      });
    });

    describe("given tokens recorded in the gateway ledger and on traces", () => {
      beforeEach(() => {
        harness.series = TOKEN_SERIES;
        harness.activity.summary = {
          activeUsersThisWindow: 7,
          newUsersThisWindow: 1,
          spentThisWindowUsd: "430.75",
        };
        harness.activity.spendByDepartment = [
          {
            departmentId: "dep-1",
            departmentName: "Engineering",
            spendUsd: "310.50",
            tokens: 4_100_000,
            tokensEstimated: false,
          },
        ];
        harness.activity.spendByUser = [
          {
            actor: "ada@acme.test",
            spendUsd: "200.00",
            requests: 90,
            tokens: 2_600_000,
            tokensEstimated: false,
          },
        ];
      });

      /** @scenario "Every token figure names the store it was counted in" */
      it("names a store on the face of every token panel, and never one figure for both", () => {
        // The two stores measure different things for the same call — the
        // gateway's own customer span publishes the cache-subtracted figure
        // and never carries audio or image counts at all (ADR-128 v3.18,
        // striking "the two stores then agree by construction"). They will
        // disagree, and the label is what stops that reading as a defect.
        renderScreen();

        const tokenPanels = allPanels().filter((panel) =>
          /token/i.test(panel.textContent ?? ""),
        );
        // SELF-CHECK BEFORE THE RULE. Every assertion below is universally
        // quantified over this list, so an empty list would pass all of them
        // while the screen showed no tokens anywhere. Three panels carry
        // tokens once this ships: the metered lane over time, the department
        // panel and the people panel.
        expect(tokenPanels.length).toBeGreaterThanOrEqual(3);

        // The gateway lane says so in the panel itself, not in a footnote
        // somewhere else on the page.
        expect(panelHolding("Tokens over time").textContent ?? "").toMatch(
          /gateway/i,
        );

        for (const panel of tokenPanels) {
          const text = panel.textContent ?? "";
          const namesGateway = /gateway/i.test(text);
          const namesTraces = /trace/i.test(text);
          // Exactly one store per panel. Naming both is how one figure
          // covering both stores would reach the screen.
          expect(
            namesGateway !== namesTraces,
            `panel names ${namesGateway && namesTraces ? "both stores" : "no store"}: ${text.slice(0, 120)}`,
          ).toBe(true);
        }
      });
    });

    describe("given departments whose people ran traffic under the organization's projects", () => {
      beforeEach(() => {
        harness.activity.summary = {
          activeUsersThisWindow: 12,
          newUsersThisWindow: 2,
          spentThisWindowUsd: "430.75",
        };
      });

      /** @scenario "A department reports the tokens it ran, across every project of the organization" */
      it("leads the department with a token count rather than a dollar amount", () => {
        // The read is already org-wide — `spendByDepartment` resolves every
        // project of the organization and passes `tenantIds`
        // (activityMonitor.service.ts:586-620), so cross-org traffic cannot
        // reach this list by construction. What is wrong is the UNIT: the
        // panel renders `Number(row.spendUsd)` through `fmtMoney`
        // (costs.tsx:1748-1760), so a department is ranked and read in money.
        harness.activity.spendByDepartment = [
          {
            departmentId: "dep-1",
            departmentName: "Engineering",
            spendUsd: "310.50",
            // Both of the organization's projects, added up by the read.
            tokens: 4_100_000,
            tokensEstimated: false,
          },
        ];

        renderScreen();

        const panel = panelHolding("Engineering");
        const row = rowFor(panel, "dep-1");
        expect(lead(row)).toMatch(/token/i);
        expect(lead(row)).not.toMatch(/\$/);
      });

      /** @scenario "A department of subscription users shows the tokens it really used" */
      it("shows a subscription department the traffic it ran instead of filing it as cheapest", () => {
        // Routed subscription conversations are assembled deliberately
        // cost-free (conversationTraceAssembly.ts:42-52), so this department's
        // every request carries no per-request cost. On dollars it sinks to
        // the bottom of the panel on the strength of a zero it never earned.
        harness.activity.spendByDepartment = [
          {
            departmentId: "dep-subscription",
            departmentName: "Legal",
            spendUsd: "0",
            tokens: 5_000_000,
            tokensEstimated: false,
          },
          {
            departmentId: "dep-metered",
            departmentName: "Engineering",
            spendUsd: "400.00",
            tokens: 100_000,
            tokensEstimated: false,
          },
        ];

        renderScreen();

        const panel = panelHolding("Legal");
        const subscription = rowFor(panel, "dep-subscription");
        expect(lead(subscription)).toMatch(/token/i);
        expect(lead(subscription)).not.toMatch(/\$/);
        // Fifty times the traffic of the department beside it, so it is not
        // the smallest row on a panel that ranks by what was run.
        expect(rankRows(panel)[0]?.dataset.rankRow).toBe("dep-subscription");
      });

      /** @scenario "A department with no token rows says it was not measured" */
      it("says a department with no token rows was not measured rather than printing a zero", () => {
        // The Copilot Studio mapper carries no token field at all, and
        // `TotalPromptTokenCount` is `Nullable(UInt32)` that stays null for
        // these rows (ADR-128 v3.18, narrowing ruling 7). A zero here would
        // be a number the screen never measured — the same rule the adoption
        // headcount above is held to.
        harness.activity.spendByDepartment = [
          {
            departmentId: "dep-1",
            departmentName: "Engineering",
            spendUsd: "310.50",
            tokens: 1_000_000,
            tokensEstimated: false,
          },
          {
            departmentId: "dep-unmeasured",
            departmentName: "Support",
            spendUsd: "120.25",
            tokens: null,
            tokensEstimated: false,
          },
        ];

        renderScreen();

        const panel = panelHolding("Support");
        const row = rowFor(panel, "dep-unmeasured");
        expect(row.textContent ?? "").toMatch(/not measured/i);
        expect(lead(row)).not.toMatch(/\b0\b/);
      });

      /** @scenario "A department whose tokens were estimated says so on its row" */
      it("labels the estimated department and leaves the reported one unlabelled", () => {
        // The Genie mapper declines to copy the puller's literal zeros and
        // leaves the estimator to count text, stamping
        // `langwatch.tokens.estimated = true` (genieTraceMapper.ts:475-477).
        // An estimate beside a provider-reported count, both unlabelled,
        // reads as one measurement.
        harness.activity.spendByDepartment = [
          {
            departmentId: "dep-estimated",
            departmentName: "Legal",
            spendUsd: "0",
            tokens: 5_000_000,
            tokensEstimated: true,
          },
          {
            departmentId: "dep-reported",
            departmentName: "Engineering",
            spendUsd: "400.00",
            tokens: 1_000_000,
            tokensEstimated: false,
          },
        ];

        renderScreen();

        const panel = panelHolding("Legal");
        expect(rowFor(panel, "dep-estimated").textContent ?? "").toMatch(
          /estimated/i,
        );
        expect(rowFor(panel, "dep-reported").textContent ?? "").not.toMatch(
          /estimated/i,
        );
      });

      /** @scenario "The department panel keeps its dollar figure as a second line" */
      it("keeps the dollar figure beneath the tokens, saying what it covers", () => {
        // Tokens are a worse COST ranking across a mixed model estate — ten
        // million tokens through a cheap model can cost less than one million
        // through an expensive one — so the dollars stay on the panel rather
        // than being dropped. Beneath, and saying what they cover, because a
        // subscription department's zero is not a cheap department.
        harness.activity.spendByDepartment = [
          {
            departmentId: "dep-1",
            departmentName: "Engineering",
            spendUsd: "310.50",
            tokens: 4_100_000,
            tokensEstimated: false,
          },
          {
            departmentId: "dep-2",
            departmentName: "Support",
            spendUsd: "120.25",
            tokens: 900_000,
            tokensEstimated: false,
          },
        ];

        renderScreen();

        const panel = panelHolding("Engineering");
        for (const key of ["dep-1", "dep-2"]) {
          expect(lead(rowFor(panel, key))).toMatch(/token/i);
        }
        expect(secondary(rowFor(panel, "dep-1"))).toContain("$310.50");
        expect(secondary(rowFor(panel, "dep-2"))).toContain("$120.25");
        expect(panel.textContent ?? "").toMatch(/per-request/i);
      });
    });

    describe("given people with both token counts and per-request costs recorded", () => {
      beforeEach(() => {
        harness.activity.summary = {
          activeUsersThisWindow: 2,
          newUsersThisWindow: 0,
          spentThisWindowUsd: "510.00",
        };
        // Ada costs more; Bob ran ninety times the tokens. The two orderings
        // disagree on purpose, so a panel that shipped the unit without the
        // sort key is caught rather than accidentally satisfied.
        harness.activity.spendByUser = [
          {
            actor: "ada@acme.test",
            spendUsd: "500.00",
            requests: 120,
            tokens: 100_000,
            tokensEstimated: false,
          },
          {
            actor: "bob@acme.test",
            spendUsd: "10.00",
            requests: 40,
            tokens: 9_000_000,
            tokensEstimated: false,
          },
        ];
      });

      /** @scenario "The panel counting people is titled for the store it reads" */
      it("titles the people panel for the trace store instead of metered gateway spend", () => {
        // "Metered" names the gateway ledger everywhere else on this screen,
        // and the gateway lane is not allowed to be grouped by person at all.
        // A panel cannot be fixed by filling it while its title still points
        // at the wrong store. Today: costs.tsx:1272.
        renderScreen();

        const panel = panelHolding("ada@acme.test");
        const heading = panel.querySelector("h1, h2, h3, h4, h5, h6");
        expect(heading).not.toBeNull();
        const title = heading?.textContent ?? "";

        expect(title).not.toBe("Metered spend by person");
        expect(title).toMatch(/trace/i);
        expect(
          screen.queryByText("Metered spend by person"),
        ).not.toBeInTheDocument();
      });

      /** @scenario "The panel counting people reports tokens rather than dollars" */
      it("leads each person with their tokens and ranks the panel by them", () => {
        // The panel is ranked and paginated on the server — the sort
        // whitelist the spend read splices into its ORDER BY,
        // `SORT_FIELD_TO_AGG_EXPR`, offers spend, requests and lastActivity
        // and holds no token key. Shipping the unit without the sort key
        // leaves page one ordered by dollars while showing tokens, and a "top
        // ten" that is not the top ten.
        //
        // (The file that whitelist lives in is deliberately not named here:
        // this test is jsdom-only, and naming a datastore module in its source
        // moves the whole file into the datastore lane — see
        // src/test-utils/integrationLanes.ts.)
        renderScreen();

        const panel = panelHolding("ada@acme.test");
        const order = rankRows(panel).map((row) => row.dataset.rankRow);
        expect(order[0]).toBe("bob@acme.test");

        for (const actor of ["bob@acme.test", "ada@acme.test"]) {
          const figure = lead(rowFor(panel, actor));
          expect(figure).toMatch(/token/i);
          expect(figure).not.toMatch(/\$/);
        }
      });
    });
  });
});
