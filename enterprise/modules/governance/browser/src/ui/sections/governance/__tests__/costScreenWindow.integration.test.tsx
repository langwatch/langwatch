// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The cost screen's time controls and its sample panels, read off the mounted
 * page with a sized chart container so recharts draws the bars and axes.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { builtinRolePermissions } from "@langwatch/authz-contract";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import type * as rechartsModule from "recharts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sampleAdoption } from "../../../../features/costs/model/sample-series.ts";
import { GovernanceHostProvider } from "../../../../model/governance-host.ts";
import { fakeGovernanceHost } from "../../../../testing.tsx";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof rechartsModule>();
  return {
    ...actual,
    // jsdom has no layout: this is the only reason a chart draws at all.
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 240 }),
  };
});

const harness = vi.hoisted(() => ({
  summary: undefined as unknown,
  summaryAsked: [] as { windowDays: number }[],
  activity: {
    summary: undefined as unknown,
    spendByDepartment: undefined as unknown,
    spendByUser: undefined as unknown,
    spendOverTime: undefined as unknown,
  },
}));

vi.mock("../../../../behavior/governance-api.ts", () => ({
  api: {
    governanceCost: {
      spenders: { useQuery: () => ({ data: undefined }) },
      dailyByProvider: { useQuery: () => ({ data: undefined }) },
      spendByModel: { useQuery: () => ({ data: undefined }) },
      periodRecords: { useQuery: () => ({ data: undefined }) },
      summary: {
        useQuery: (input: { windowDays: number }) => {
          harness.summaryAsked.push(input);
          return { data: harness.summary, isLoading: false, isError: false };
        },
      },
    },
    activityMonitor: {
      summary: { useQuery: () => ({ data: harness.activity.summary }) },
      spendByDepartment: { useQuery: () => ({ data: harness.activity.spendByDepartment }) },
      spendByUser: { useQuery: () => ({ data: harness.activity.spendByUser }) },
      spendOverTime: { useQuery: () => ({ data: harness.activity.spendOverTime }) },
    },
  },
}));

import CostsPage from "../governance-costs.screen.tsx";

const renderScreen = () =>
  renderWithDesignSystem(
    <GovernanceHostProvider
      value={fakeGovernanceHost({
        permissions: [...builtinRolePermissions("org-admin"), ...builtinRolePermissions("admin")],
        plan: { isEnterprise: true, isLoading: false },
      })}
    >
      <CostsPage />
    </GovernanceHostProvider>,
  );

const emptyLane = {
  amountUsd: null,
  cellsWithoutAmount: 0,
  currenciesWithoutUsdAmount: [],
  currencyTotals: [],
};

/** A summary whose lanes report nothing, over the given daily rows. */
const summaryOver = (
  series: { day: string; billedUsd: number | null; gatewayUsd: number | null }[],
) => ({
  unavailableReason: null,
  billed: emptyLane,
  gateway: emptyLane,
  seats: { status: "awaiting_data" },
  series,
  windowDays: 365,
});

const withNothingMeasured = () => {
  harness.summary = summaryOver([]);
  harness.activity = {
    summary: { activeUsersThisWindow: 0, newUsersThisWindow: 0, spentThisWindowUsd: "0" },
    spendByDepartment: [],
    spendByUser: [],
    spendOverTime: { buckets: [] },
  };
};

const sampleModeOn = () => window.sessionStorage.setItem("governance.sample", "true");

const panelTitled = (title: string) => {
  const panel = screen.getByRole("heading", { name: title }).closest('[data-testid="cost-panel"]');
  if (!(panel instanceof HTMLElement)) throw new Error(`no panel titled ${title}`);
  return panel;
};

const barOffsets = (panel: HTMLElement) =>
  [...panel.querySelectorAll(".recharts-bar-rectangle path")].map(
    (bar) => bar.getAttribute("d")?.match(/^M ([\d.]+),/)?.[1],
  );

beforeEach(() => {
  window.sessionStorage.clear();
  harness.summaryAsked = [];
  withNothingMeasured();
});

afterEach(() => cleanup());

describe("the cost screen on first open", () => {
  /** @scenario "The screen opens on the last twelve months bucketed by quarter" */
  it("reads Last 12 months and Quarter on its chips and offers no Group By", () => {
    renderScreen();

    const chips = screen.getAllByRole("button").map((button) => button.textContent);
    expect(chips).toContain("Time Frame·Last 12 months");
    expect(chips).toContain("Time Interval·Quarter");
    expect(chips.some((chip) => /group by/i.test(chip ?? ""))).toBe(false);
    expect(screen.queryByText(/group by/i)).toBeNull();
  });
});

describe("given the Time Interval is Quarter", () => {
  /** @scenario "Every chart on the screen is ticked by the interval in view" */
  it("ticks every chart's time axis by quarter and says once which bucket the charts use", () => {
    sampleModeOn();
    renderScreen();

    const tickLabelsByPanel = [...document.querySelectorAll('[data-testid="cost-panel"]')]
      .map((panel) =>
        [...panel.querySelectorAll(".recharts-cartesian-axis-tick-value")].map(
          (tick) => tick.textContent ?? "",
        ),
      )
      .filter((ticks) => ticks.length > 0);
    // Every tick is a quarter or a value on the other axis, never a day or month.
    const isQuarter = (tick: string) => /^Q[1-4] \d{4}$/.test(tick);
    const isValue = (tick: string) => /^[$€]?[\d.,]+[kmb]?$/i.test(tick);
    for (const ticks of tickLabelsByPanel) {
      for (const tick of ticks) expect(isQuarter(tick) || isValue(tick), tick).toBe(true);
    }
    const panelsOnQuarters = tickLabelsByPanel.filter((ticks) => ticks.some(isQuarter));
    expect(panelsOnQuarters.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/bucketed by quarter/i)).toHaveLength(1);
  });
});

describe("given the reader picks a Time Frame of two years", () => {
  /** @scenario "A frame longer than the reads answer says how far the figures reach" */
  it("asks for a year, says the figures cover the last 12 months and never labels them two years", async () => {
    harness.summary = summaryOver([{ day: "2026-08-01", billedUsd: 5, gatewayUsd: null }]);
    renderScreen();

    await userEvent.click(screen.getByText("Time Frame").closest("button") as HTMLButtonElement);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Last 2 years" }));

    const note = await screen.findByTestId("cost-read-ceiling-note");
    expect(note).toHaveTextContent(/figures cover the last 12 months/i);
    expect(note.textContent).not.toMatch(/2 years|two years/i);
    expect(harness.summaryAsked.at(-1)).toMatchObject({ windowDays: 365 });
    expect(harness.summaryAsked.some((asked) => asked.windowDays > 365)).toBe(false);
  });
});

describe("given a year in which every day cost exactly the same", () => {
  /** @scenario "A window whose spend never moved says level on both money lanes" */
  it("reads level on the billed lane and on the metered lane", () => {
    const days = Array.from({ length: 365 }, (_, index) => ({
      day: new Date(Date.UTC(2025, 9, 1 + index)).toISOString().slice(0, 10),
      billedUsd: 7,
      gatewayUsd: 3,
    }));
    harness.summary = {
      ...summaryOver(days),
      billed: {
        ...emptyLane,
        amountUsd: 2555,
        currencyTotals: [{ currencyCode: "USD", amount: 2555, cellsWithoutAmount: 0 }],
      },
      gateway: {
        ...emptyLane,
        amountUsd: 1095,
        currencyTotals: [{ currencyCode: "USD", amount: 1095, cellsWithoutAmount: 0 }],
      },
    };
    renderScreen();

    expect(screen.getByTestId("cost-lane-billed-trend")).toHaveTextContent("level");
    expect(screen.getByTestId("cost-lane-gateway-trend")).toHaveTextContent("level");
  });
});

describe("given sample mode is on and nothing is measured", () => {
  beforeEach(sampleModeOn);

  /** @scenario "The adoption panel shows sample figures rather than nothing" */
  it("fills the adoption panel with invented adoption figures under the one sample banner", () => {
    renderScreen();

    const adoption = within(panelTitled("Adoption"));
    expect(adoption.getByText("People using AI tools")).toBeInTheDocument();
    expect(adoption.getByText(String(sampleAdoption().peopleUsingAiTools))).toBeInTheDocument();
    expect(adoption.queryByText(/nothing in this window yet/i)).toBeNull();
    expect(screen.getAllByText(/nothing here is real/i)).toHaveLength(1);
  });

  /** @scenario "The department chip offers sample departments while sample mode is on" */
  it("offers the sample departments and narrows the invented breakdown to the one picked", async () => {
    renderScreen();
    expect(within(panelTitled("Cost by department")).getByText("Engineering")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Department").closest("button") as HTMLButtonElement);
    for (const name of [
      "Engineering",
      "Data & AI",
      "Customer Support",
      "Marketing",
      "Unallocated",
    ]) {
      expect(await screen.findByRole("menuitem", { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("menuitem", { name: "Marketing" }));

    const breakdown = within(panelTitled("Cost by department"));
    expect(breakdown.getByText("Marketing")).toBeInTheDocument();
    expect(breakdown.queryByText("Engineering")).toBeNull();
    expect(breakdown.queryByText("Customer Support")).toBeNull();
  });

  /** @scenario "A window of empty days fills with sample figures like every panel beside it" */
  it("draws invented bars in the cost-over-time panel and reports no panel as measured and empty", () => {
    harness.summary = summaryOver(
      Array.from({ length: 365 }, (_, index) => ({
        day: new Date(Date.UTC(2025, 9, 1 + index)).toISOString().slice(0, 10),
        billedUsd: 0,
        gatewayUsd: 0,
      })),
    );
    renderScreen();

    expect(barOffsets(panelTitled("Cost over time")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("cost-panel-empty")).toBeNull();
    expect(screen.queryByText(/nothing in this window yet/i)).toBeNull();
  });

  /** @scenario "Seats are drawn as counts against a seat axis, never as money" */
  it("plots bought beside assigned as counts, with no currency and no stacking", () => {
    renderScreen();

    const seats = panelTitled("Seats · bought against assigned");
    expect(within(seats).getByText("Seats bought")).toBeInTheDocument();
    expect(within(seats).getByText("Seats assigned")).toBeInTheDocument();
    expect(seats.textContent).not.toMatch(/[$€£]|USD|EUR/);
    const yAxis = [...seats.querySelectorAll(".recharts-cartesian-axis-tick-value")];
    expect(yAxis.length).toBeGreaterThan(0);
    const valueTicks = yAxis.filter((tick) => !/^Q[1-4] \d{4}$/.test(tick.textContent ?? ""));
    expect(valueTicks.length).toBeGreaterThan(0);
    for (const tick of valueTicks) expect(tick.textContent).toMatch(/^[\d,]+$/);
    // Two bars per period, each at its own offset: drawn side by side, not on top.
    const offsets = barOffsets(seats);
    expect(offsets.length).toBeGreaterThan(0);
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  /** @scenario "No panel is named after a single provider's product" */
  it("titles no panel with a provider's product and names the forecast for metered spend", () => {
    renderScreen();

    const titles = [...document.querySelectorAll('[data-testid="cost-panel"] h2')].map(
      (heading) => heading.textContent ?? "",
    );
    expect(titles.length).toBeGreaterThan(8);
    for (const title of titles) {
      expect(title).not.toMatch(
        /openai|anthropic|claude|gpt|copilot|genie|databricks|azure|gemini/i,
      );
    }
    expect(titles).toContain("Metered spend forecast · by agent");
  });
});
