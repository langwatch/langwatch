/**
 * @vitest-environment jsdom
 *
 * The three Platform placeholder screens, mounted through their real pages
 * and guards. What is under test is the small set of promises the screens
 * make: they stay behind the billed-cost flag, they say exactly what they
 * say, Open Langy opens Langy, and the Setup dialog keeps its edits for the
 * sitting without ever claiming to have stored them.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOrganizationRolePermissions,
  hasPermissionWithHierarchy,
} from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  flagEnabled: true,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => {
  const holds = (permission: string) =>
    hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    // The section-wide flag stays on so the tests are about THIS flag.
    enabled:
      flag === "release_ui_governance_billed_cost_enabled"
        ? harness.flagEnabled
        : true,
    isLoading: false,
  }),
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

import { useLangyStore } from "~/features/langy/stores/langyStore";
import AnalyticsPage from "../analytics";
import InsightsPage from "../insights";
import SignalsPage from "../signals";

function renderPage(Page: React.ComponentType) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Page />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  harness.permissions = getOrganizationRolePermissions("ADMIN");
  harness.flagEnabled = true;
  // The store persists `isOpen` and the unit lane shares the module between
  // files, so the panel can arrive already open. Start closed, every time.
  localStorage.clear();
  useLangyStore.setState({ isOpen: false });
});

afterEach(() => {
  cleanup();
});

describe("given the billed-cost flag is off for a permitted viewer", () => {
  /** @scenario "The Platform screens are unreachable with the billed-cost flag off" */
  it("shows the not-found scene on every Platform screen", () => {
    expect(
      hasPermissionWithHierarchy(harness.permissions, "governance:view"),
    ).toBe(true);
    harness.flagEnabled = false;

    for (const Page of [InsightsPage, AnalyticsPage, SignalsPage]) {
      renderPage(Page);
      expect(screen.getByText("this page does not exist")).toBeInTheDocument();
      cleanup();
    }

    // The identical setup with the flag ON renders the screens, which is
    // what makes the assertion above about the FLAG.
    harness.flagEnabled = true;
    renderPage(InsightsPage);
    expect(
      screen.getByRole("heading", { name: "Insights" }),
    ).toBeInTheDocument();
  });
});

describe("given the Insights screen", () => {
  /** @scenario "Insights opens on an empty brief with one sentence of promise" */
  it("opens on the empty brief with exactly one sentence of promise", () => {
    renderPage(InsightsPage);

    expect(
      screen.getByRole("heading", { name: "Insights" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Every morning a background job reads yesterday's traffic and files a couple of high-signal insights: not fifteen a day.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Push back on one/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set up data" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Langy" }),
    ).toBeInTheDocument();
  });

  /** @scenario "Open Langy opens the Langy panel" */
  it("opens the Langy panel from Open Langy", () => {
    renderPage(InsightsPage);
    expect(useLangyStore.getState().isOpen).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open Langy" }));

    expect(useLangyStore.getState().isOpen).toBe(true);
  });

  /** @scenario "The Setup dialog keeps its edits for the sitting and never claims to save" */
  it("keeps a saved edit across close and reopen, with no confirmation", async () => {
    renderPage(InsightsPage);

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));
    const runs = await screen.findByLabelText("Runs");
    expect(runs).toHaveValue("daily");
    fireEvent.change(runs, { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.queryByLabelText("Runs")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));
    expect(await screen.findByLabelText("Runs")).toHaveValue("weekly");
  });

  /** @scenario "Cancel discards the sitting's edits" */
  it("discards an edit on Cancel", async () => {
    renderPage(InsightsPage);

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));
    fireEvent.change(await screen.findByLabelText("Runs"), {
      target: { value: "weekly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Runs")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));
    expect(await screen.findByLabelText("Runs")).toHaveValue("daily");
  });
});

describe("given the Signals & Alerts screen", () => {
  /** @scenario "Signals & Alerts opens on an empty registry" */
  it("opens on the empty registry with its two links", () => {
    renderPage(SignalsPage);

    expect(
      screen.getByRole("heading", { name: "Signals & Alerts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No rules scoped here yet. Create one from any chart's bell icon.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Insights inbox" }),
    ).toHaveAttribute("href", "/governance/insights");
    expect(
      screen.getByRole("link", { name: "model providers" }),
    ).toHaveAttribute("href", "/settings/model-providers");
  });
});

describe("given the Analytics screen", () => {
  /** @scenario "Analytics opens on the spend-by-department template" */
  it("opens on spend by department, weekly, with no data", () => {
    renderPage(AnalyticsPage);

    expect(
      screen.getByRole("heading", { name: "Analytics" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cost by department · weekly")).toBeInTheDocument();
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(
      screen.getByText("usage | summarize sum(cost) by department, bin(1w)"),
    ).toBeInTheDocument();
  });

  /** @scenario "A template rewrites the three controls at once" */
  it("rewrites measure, breakdown and interval from a template", () => {
    renderPage(AnalyticsPage);

    fireEvent.click(screen.getByRole("button", { name: "Requests by model" }));

    expect(screen.getByLabelText("Measure")).toHaveValue("requests");
    expect(screen.getByLabelText("Break down by")).toHaveValue("model");
    expect(screen.getByLabelText("Over time")).toHaveValue("day");
    expect(
      screen.getByText("usage | summarize count() by model, bin(1d)"),
    ).toBeInTheDocument();
  });
});
