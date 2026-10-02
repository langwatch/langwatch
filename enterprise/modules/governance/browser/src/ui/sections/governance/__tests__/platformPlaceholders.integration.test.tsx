// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The three Platform screens on first open: what each says, what it offers, and what it does
 * not claim. Real pages over the fake host; the API is a boundary that answers nothing.
 * @see specs/governance/governance-platform-placeholders.feature
 */
import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_SURFACE,
  LANGY_STORE_SLICE,
  type LangySliceSurface,
} from "@langwatch/langy-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";

vi.mock("../../../../behavior/governance-api.ts", () => {
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
          }
          if (property === "useUtils") return () => node();
          if (["invalidate", "refetch", "fetch"].includes(property)) return vi.fn();
          return node();
        },
      },
    );
  const api = node();
  return { api, governanceApi: api };
});

import AnalyticsScreen from "../analytics.tsx";
import InsightsScreen from "../insights.tsx";
import SignalsScreen from "../signals.tsx";

const FLAGS = ["release_ui_ai_governance_enabled", "release_ui_governance_billed_cost_enabled"];

function open(page: ReactElement) {
  return renderWithGovernanceHost(page, {
    host: fakeGovernanceHost({
      enabledFlags: FLAGS,
      permissions: ["organization:view", "governance:view"],
    }),
  });
}

// Stands in for Langy, the owner of the slice, which this package only reads.
const langy = defineSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  create: (set) => ({ ...LANGY_ABSENT_SURFACE, openPanel: () => set({ isOpen: true }) }),
});

afterEach(() => {
  cleanup();
  langy.setState({ isOpen: false });
});

describe("the Insights screen on first open", () => {
  /** @scenario "Insights opens on an empty brief with one sentence of promise" */
  it("carries a Preview badge over an empty brief with one sentence and two actions", () => {
    open(<InsightsScreen />);

    expect(screen.getByRole("heading", { name: "Insights" })).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    const brief = screen.getByTestId("insights-empty-brief");
    expect(within(brief).getByText("Langy will write your brief here")).toBeInTheDocument();
    expect(
      within(brief).getByText(
        "A couple of things worth acting on each day, never a feed of fifteen. Nothing has been filed here yet.",
      ),
    ).toBeInTheDocument();
    expect(within(brief).getByRole("button", { name: "Set up data" })).toBeInTheDocument();
    expect(within(brief).getByRole("button", { name: "Open Langy" })).toBeInTheDocument();
  });

  /** @scenario "The inbox rail is in place at zero" */
  it("lists every folder at zero, opens on the inbox, and shows a picked folder's empty line", async () => {
    open(<InsightsScreen />);

    const rail = screen.getByRole("navigation", { name: "Insights folders" });
    const names = ["Inbox", "Stale", "Archived", "Alerts", "Notifications"];
    for (const name of names) {
      expect(within(rail).getByRole("button", { name: `${name}0` })).toBeInTheDocument();
    }
    expect(within(rail).getByRole("button", { name: "Inbox0" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByTestId("insights-empty-brief")).toBeInTheDocument();

    await userEvent.click(within(rail).getByRole("button", { name: "Stale0" }));

    expect(screen.queryByTestId("insights-empty-brief")).not.toBeInTheDocument();
    expect(
      screen.getByText("Nothing has gone stale. Insights land here when their validity runs out."),
    ).toBeInTheDocument();
  });

  /** @scenario "Open Langy opens the Langy panel" */
  it("opens the Langy panel when Open Langy is pressed", async () => {
    open(<InsightsScreen />);
    expect(langy.getState().isOpen).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Open Langy" }));

    expect(langy.getState().isOpen).toBe(true);
  });
});

describe("the Signals & Alerts screen on first open", () => {
  /** @scenario "Signals & Alerts opens on an empty registry" */
  it("carries a Preview badge over an empty registry and links to the two places it names", () => {
    open(<SignalsScreen />);

    expect(screen.getByRole("heading", { name: "Signals & Alerts" })).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByTestId("signals-empty-registry")).toHaveTextContent(
      "No rules here yet. Creating one is coming.",
    );
    expect(screen.getByRole("link", { name: "Insights inbox" })).toHaveAttribute(
      "href",
      "/governance/insights",
    );
    expect(screen.getByRole("link", { name: "model providers" })).toHaveAttribute(
      "href",
      "/settings/model-providers",
    );
  });

  /** @scenario "The Signals header actions are offered disabled until they do something" */
  it("offers New alert and New signal disabled, and pressing either changes nothing", async () => {
    const { container } = open(<SignalsScreen />);
    const before = container.innerHTML;

    for (const name of ["New alert", "New signal"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      await userEvent.click(button);
    }

    expect(container.innerHTML).toBe(before);
  });
});

describe("the Analytics screen on first open", () => {
  /** @scenario "Analytics opens on the spend-by-department template" */
  it("carries a Preview badge over the unconnected cost-by-department chart and its query line", () => {
    open(<AnalyticsScreen />);

    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Cost by department · weekly")).toBeInTheDocument();
    expect(screen.getByText("This chart is not connected to your data yet")).toBeInTheDocument();
    expect(
      screen.getByText("usage | summarize sum(cost) by department, bin(1w)"),
    ).toBeInTheDocument();
  });
});

describe("the copy on the Platform screens", () => {
  const CLAIMS_OF_WORK_DONE =
    /\b(is running|are running|is firing|are firing|has fired|have fired|is executed|are executed|has been sent)\b/i;

  /** @scenario "The Platform screens describe unbuilt work in the future tense" */
  it.each([
    ["Signals & Alerts", <SignalsScreen key="signals" />],
    ["Analytics", <AnalyticsScreen key="analytics" />],
    ["Insights", <InsightsScreen key="insights" />],
  ])("claims no work already done on the %s screen", (_name, page) => {
    const { container } = open(page);

    expect(container.textContent ?? "").not.toMatch(CLAIMS_OF_WORK_DONE);
  });
});
