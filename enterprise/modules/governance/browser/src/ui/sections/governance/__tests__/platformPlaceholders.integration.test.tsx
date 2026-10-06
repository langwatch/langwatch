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
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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

  /** @scenario "The Setup drawer keeps its edits for the sitting and never claims to save" */
  it("keeps a saved schedule on reopening and raises no confirmation", async () => {
    const host = fakeGovernanceHost({
      enabledFlags: FLAGS,
      permissions: ["organization:view", "governance:view"],
    });
    const { container } = renderWithGovernanceHost(<InsightsScreen />, { host });

    await userEvent.click(screen.getByRole("button", { name: "Set up data" }));
    const at = () => document.body.querySelector<HTMLInputElement>('input[type="time"]');
    expect(at()?.value).toBe("07:00");
    fireEvent.change(at() as HTMLInputElement, { target: { value: "09:30" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByText("Set up Insights")).not.toBeInTheDocument());
    expect(host.recording.successes).toEqual([]);
    expect(host.recording.failures).toEqual([]);
    expect(container.textContent ?? "").not.toMatch(/\b(saved|stored)\b/i);

    await userEvent.click(screen.getByRole("button", { name: "Set up data" }));
    expect(at()?.value).toBe("09:30");
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

describe("every screen on the Platform section", () => {
  const screens: [string, () => ReactElement][] = [
    ["/governance/analytics", () => <AnalyticsScreen />],
    ["/governance/insights", () => <InsightsScreen />],
    ["/governance/signals", () => <SignalsScreen />],
  ];

  /** @scenario "Every control the Platform screens offer does something when pressed" */
  it("answers a press on every enabled control of all three screens with a visible change", async () => {
    for (const [path, page] of screens) {
      const host = fakeGovernanceHost({
        enabledFlags: FLAGS,
        permissions: ["organization:view", "governance:view"],
      });
      const controlCount = () =>
        renderWithGovernanceHost(page(), { host }).container.querySelectorAll(
          "button:not([disabled])",
        ).length;
      const count = controlCount();
      cleanup();
      const links = renderWithGovernanceHost(page(), { host }).container.querySelectorAll(
        "a[href]",
      );
      expect(count + links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.getAttribute("href"), `${link.textContent} is a dead link`).toMatch(
          /^\/|^https?:/,
        );
      }
      cleanup();

      for (let index = 0; index < count; index += 1) {
        const { container } = renderWithGovernanceHost(page(), { host });
        const control = container.querySelectorAll("button:not([disabled])")[index];
        if (!control) throw new Error(`no control ${index}`);
        const label = control.textContent || control.getAttribute("aria-label") || `#${index}`;
        // The folder already open is where pressing it would take the reader.
        if (control.getAttribute("aria-current") === "true") {
          cleanup();
          continue;
        }
        const before = document.body.innerHTML;
        const navigationsBefore = host.recording.navigations.length;
        const panelWasOpen = langy.getState().isOpen;

        await userEvent.click(control);

        const acted =
          document.body.innerHTML !== before ||
          host.recording.navigations.length !== navigationsBefore ||
          langy.getState().isOpen !== panelWasOpen;
        expect(acted, `pressing "${label}" changed nothing on ${path}`).toBe(true);
        langy.setState({ isOpen: false });
        cleanup();
      }
    }
  }, 120_000);
});
