/**
 * @vitest-environment jsdom
 *
 * Tests sample mode on Costs page; no failures drawn, all sample panels labeled.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SampleMark,
  SampleSaidOnce,
} from "~/components/governance/costs/sampleMark";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  summaryFails: false,
  realFigures: false,
  spendersFail: false,
  /**
   * The over-time read answering a row per day with nothing spent on any —
   * what an empty window looks like on the wire, since days are the read's
   * own axis and it emits them whether or not anything landed on one.
   */
  overTimeAnswersEmptyDays: false,
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

vi.mock("~/utils/api", () => {
  return {
    api: {
      governanceCost: {
        // The day-split read answers nothing here: it is its own panel with
        // its own tests, and these stay about their own subject.
        dailyByProvider: { useQuery: () => ({ data: undefined }) },
        spendByModel: { useQuery: () => ({ data: undefined }) },
        summary: {
          useQuery: () => ({
            data: harness.summaryFails
              ? undefined
              : {
                  unavailableReason: null,
                  billed: {
                    amountUsd: harness.realFigures ? 987654 : null,
                    cellsWithoutAmount: 0,
                    currenciesWithoutUsdAmount: [],
                    currencyTotals: harness.realFigures
                      ? [
                          {
                            currencyCode: "USD",
                            amount: 987654,
                            cellsWithoutAmount: 0,
                          },
                        ]
                      : [],
                  },
                  gateway: {
                    amountUsd: null,
                    cellsWithoutAmount: 0,
                    currenciesWithoutUsdAmount: [],
                    currencyTotals: [],
                  },
                  seats: { status: "awaiting_data" },
                  series: [],
                  staleSources: null,
                  unpricedWindow: null,
                  azureBilling: null,
                  windowDays: 365,
                },
            isLoading: false,
            isError: harness.summaryFails,
          }),
        },
        spenders: {
          useQuery: () => ({
            data: harness.realFigures
              ? {
                  rows: [
                    {
                      provider: "openai",
                      rawActorId: "real-key",
                      label: "Real billing key",
                      agentId: "",
                      amountUsd: 987654,
                      cellsWithoutAmount: 0,
                    },
                  ],
                }
              : undefined,
            isError: harness.spendersFail,
            refetch: () => undefined,
          }),
        },
      },
      activityMonitor: {
        summary: {
          useQuery: () => ({
            data: harness.realFigures
              ? { activeUsersThisWindow: 9876 }
              : undefined,
            isLoading: false,
            isError: false,
          }),
        },
        spendByDepartment: {
          useQuery: () => ({
            data: harness.realFigures
              ? [
                  {
                    departmentId: "real-department",
                    departmentName: "Real department",
                    spendUsd: "54321",
                    requests: 10,
                  },
                ]
              : undefined,
          }),
        },
        spendByUser: {
          useQuery: () => ({
            data: harness.realFigures
              ? [
                  {
                    actor: "real.person@example.test",
                    spendUsd: "54321",
                    requests: 10,
                  },
                ]
              : undefined,
          }),
        },
        spendOverTime: {
          useQuery: () =>
            harness.overTimeAnswersEmptyDays
              ? {
                  data: {
                    buckets: Array.from({ length: 90 }, (_, index) => ({
                      bucketIso: `2026-0${1 + Math.floor(index / 31)}-${String(
                        (index % 31) + 1,
                      ).padStart(2, "0")}`,
                      points: [],
                    })),
                  },
                  isLoading: false,
                  isError: false,
                }
              : { data: undefined, isLoading: false, isError: false },
        },
      },
    },
  };
});

import CostsPage from "../governance-costs.screen.tsx";

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CostsPage />
    </ChakraProvider>,
  );

/** The panel card a title belongs to. */
const panelFor = (title: string) =>
  screen.getByText(title).closest('[data-testid="cost-panel"]') as HTMLElement;

/** Render, then ask for sample data the way the reader does. */
const renderInSampleMode = async () => {
  const rendered = renderScreen();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "See sample data" }));
  return rendered;
};

beforeEach(() => {
  harness.summaryFails = false;
  harness.realFigures = false;
  harness.spendersFail = false;
  harness.overTimeAnswersEmptyDays = false;
  // The section keeps ONE sample choice for the whole sitting, in session
  // storage, so the first test to press the toggle would otherwise hand its
  // answer to every test after it and they would open with samples already on.
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe("the cost screen in sample mode", () => {
  describe("given the cost read failed", () => {
    beforeEach(() => {
      harness.summaryFails = true;
    });

    /** @scenario "No error alerts are rendered while sample mode is on" */
    /** @scenario "No error alert is rendered while sample mode is on" */
    it("draws no error alert and shows invented lanes instead", async () => {
      await renderInSampleMode();

      expect(screen.queryByTestId("cost-lanes-error")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Cost data could not be loaded"),
      ).not.toBeInTheDocument();
      // The lanes are on screen, carrying figures, under the sample banner —
      // which is the thing saying they are invented now that the lanes no
      // longer each repeat it.
      expect(screen.getByTestId("cost-lane-billed")).toBeInTheDocument();
      expect(screen.getByText(/nothing here is real/i)).toBeInTheDocument();
    });

    it("brings the failure straight back when the reader turns sample off", async () => {
      await renderInSampleMode();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Hide sample data" }));

      expect(screen.getByTestId("cost-lanes-error")).toBeInTheDocument();
    });
  });

  describe("given the spender read failed", () => {
    beforeEach(() => {
      harness.spendersFail = true;
    });

    it("shows an invented spender list rather than the failure", async () => {
      await renderInSampleMode();

      const panel = panelFor("Provider-reported spend by user");

      expect(within(panel).getAllByText("ada@acme.test")).toHaveLength(2);
      expect(within(panel).queryByText(/· sk-/)).not.toBeInTheDocument();
      expect(
        within(panel).queryByText(/anthropic|microsoft/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/could not be loaded/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the activity reads never answered", () => {
    /** @scenario "The screen says figures are invented once, not once per panel" */
    it("says it in the banner and nowhere else", async () => {
      await renderInSampleMode();

      // The banner is the one statement, and it has to be a real one: if it
      // ever stops rendering, the assertion below turns into a check that an
      // unmarked screen of invented money is unmarked, and passes.
      expect(screen.getByText(/nothing here is real/i)).toBeInTheDocument();

      for (const title of [
        "Adoption",
        "Metered spend forecast · by agent",
        "Seats · bought against assigned",
        "Cost over time",
        "Cost by department",
        "Cost by model",
        "Metered spend by person",
        "Conversations over time",
        "Tokens over time",
      ]) {
        expect(within(panelFor(title)).queryByText("sample")).toBeNull();
      }
      for (const laneId of [
        "cost-lane-billed",
        "cost-lane-gateway",
        "cost-lane-seats",
      ]) {
        expect(
          within(screen.getByTestId(laneId)).queryByText("sample"),
        ).toBeNull();
      }
    });

    /** @scenario "A panel with nothing in it shows sample data instead of Not available" */
    /** @scenario "The adoption panel shows sample figures rather than nothing" */
    it("fills the adoption panel with figures instead of saying nothing", async () => {
      await renderInSampleMode();

      const panel = panelFor("Adoption");

      expect(
        within(panel).getByText("People using AI tools"),
      ).toBeInTheDocument();
      expect(within(panel).getByText("Active seats")).toBeInTheDocument();
      expect(within(panel).getByText("Tools adopted")).toBeInTheDocument();
      expect(screen.queryByText("Not available.")).not.toBeInTheDocument();
    });

    /** @scenario "The sample toggle sits top-right and the banner directly under the header" */
    it("puts the toggle beside the heading and the banner under it", async () => {
      await renderInSampleMode();

      const heading = screen.getByRole("heading", { name: "Costs" });
      const toggle = screen.getByRole("button", { name: "Hide sample data" });
      const banner = screen.getByRole("status");

      // Same row as the heading, and the banner is the row after it.
      expect(heading.parentElement).toBe(toggle.parentElement);
      expect(heading.parentElement?.nextElementSibling).toBe(banner);
    });

    /** @scenario "Seats are drawn as counts against a seat axis, never as money" */
    it("draws the seat panel as counts with no currency on it", async () => {
      await renderInSampleMode();

      const panel = panelFor("Seats · bought against assigned");

      // The title is the assertion the panel is about seats rather than
      // subscriptions in dollars. The figures themselves live inside a
      // recharts SVG that jsdom never lays out, so the reachable proof that
      // no money is drawn is that the panel carries no currency anywhere.
      expect(panel.textContent).not.toContain("$");
      expect(screen.queryByText(/Subscriptions/)).not.toBeInTheDocument();
    });

    /** @scenario "No panel is named after a single provider's product" */
    it("names panels for what they count, not for one provider's product", async () => {
      await renderInSampleMode();

      expect(screen.getByText("Conversations over time")).toBeInTheDocument();
      expect(screen.queryByText(/Genie/)).not.toBeInTheDocument();
      // "Metered" is the word the lane above uses for this money, and the
      // ADR uses throughout. "Consumption" named it a second way.
      expect(
        screen.getByText("Metered spend forecast · by agent"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Consumption/)).not.toBeInTheDocument();
    });

    /** @scenario "The department chip offers sample departments while sample mode is on" */
    it("offers the sample departments and narrows the breakdown to one", async () => {
      const user = userEvent.setup();
      await renderInSampleMode();

      await user.click(
        screen.getByText("Department").closest("button") as HTMLButtonElement,
      );
      expect(
        await screen.findByRole("menuitem", { name: "Data & AI" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("menuitem", { name: "Engineering" }));

      const panel = panelFor("Cost by department");
      expect(panel.textContent).toContain("Engineering");
      expect(panel.textContent).not.toContain("Marketing");
    });
  });

  /** Over-time read emits days vs figures; unique in empty-window behavior. */
  describe("given the over-time read answered days but no figures", () => {
    beforeEach(() => {
      harness.overTimeAnswersEmptyDays = true;
    });

    /** @scenario "A window of empty days fills with sample figures like every panel beside it" */
    it("fills the over-time panel like every panel beside it", async () => {
      await renderInSampleMode();

      // The empty state, not the chart: recharts draws nothing under jsdom, so
      // the assertion that can be made honestly is that the panel is NOT
      // reporting the window as measured and empty.
      const panel = panelFor("Cost over time");
      expect(
        within(panel).queryByTestId("cost-panel-empty"),
      ).not.toBeInTheDocument();

      // And no other panel is either. A screen where one card says "nothing
      // here" among fifteen full ones is the defect, so the absence is
      // asserted across the whole screen rather than only where it was seen.
      expect(screen.queryAllByTestId("cost-panel-empty")).toHaveLength(0);
    });
  });

  /** Guarantees invented panel is marked even without banner. */
  describe("given an invented panel with no banner above it", () => {
    /** @scenario "The sample mark returns wherever no banner speaks for it" */
    it("marks it, because nothing else on the screen would", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <SampleMark shown />
        </ChakraProvider>,
      );

      expect(screen.getByText("sample")).toBeInTheDocument();
    });

    it("stands down again once a banner is speaking for it", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <SampleSaidOnce said>
            <SampleMark shown />
          </SampleSaidOnce>
        </ChakraProvider>,
      );

      expect(screen.queryByText("sample")).toBeNull();
    });
  });
});

describe("given Costs has real figures", () => {
  /** @scenario "Sample mode replaces real cost figures and restores them when disabled" */
  it("replaces real spend and adoption until samples are disabled", async () => {
    harness.realFigures = true;
    renderScreen();
    const billed = screen.getByTestId("cost-lane-billed").textContent;
    const adoption = panelFor("Adoption").textContent;
    const realLabels = [
      "Real billing key",
      "Real department",
      "real.person@example.test",
    ];
    for (const label of realLabels)
      expect(screen.getByText(label)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "See sample data" }),
    );
    expect(screen.getByTestId("cost-lane-billed").textContent).not.toEqual(
      billed,
    );
    expect(panelFor("Adoption").textContent).not.toEqual(adoption);
    for (const label of realLabels)
      expect(screen.queryByText(label)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Hide sample data" }),
    );
    expect(screen.getByTestId("cost-lane-billed").textContent).toEqual(billed);
    expect(panelFor("Adoption").textContent).toEqual(adoption);
    for (const label of realLabels)
      expect(screen.getByText(label)).toBeInTheDocument();
  });
});
