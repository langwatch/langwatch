/**
 * @vitest-environment jsdom
 *
 * The three Platform placeholder screens, mounted through their real pages
 * and guards. What is under test is the small set of promises the screens
 * make: they stay behind the billed-cost flag, they say exactly what they
 * say, Open Langy opens Langy, and the Setup drawer keeps its edits for the
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
  within,
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

// The Model row reads the same two queries the Langy panel seeds its picker
// from. Stubbed at the tRPC boundary so the assertion is about the WIRING:
// what Langy is configured with is what the row shows.
const LANGY_CONFIGURED_MODEL = "anthropic/claude-sonnet-4.5";
const modelQueries = vi.hoisted(() => ({
  getResolvedDefault: vi.fn(),
  modelsAllowed: vi.fn(),
}));
vi.mock("~/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/api")>()),
  api: {
    modelProvider: {
      getResolvedDefault: { useQuery: modelQueries.getResolvedDefault },
    },
    langy: { modelsAllowed: { useQuery: modelQueries.modelsAllowed } },
  },
}));
// The shared picker drags the providers query and the registry along; a
// native select standing in for it keeps this file about the drawer.
vi.mock("~/components/ModelSelector", () => ({
  allModelOptions: ["openai/gpt-5-mini"],
  ModelSelector: ({
    model,
    options,
    onChange,
  }: {
    model: string;
    options: string[];
    onChange: (model: string) => void;
  }) => (
    <select
      data-testid="model-selector"
      value={model}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  ),
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

/** The standard Select keeps a hidden native <select> in sync with its
 *  state (zag's hidden select handles change), and the Field label names
 *  both it and the trigger. The native one is the one a test can read and
 *  change without portals. */
const hiddenSelect = (label: string) =>
  screen.getByLabelText(label, { selector: "select" });
const findHiddenSelect = (label: string) =>
  screen.findByLabelText(label, { selector: "select" });
/** The state machine delivers the change a tick later; the trigger's text
 *  is the proof it landed, so wait on that before pressing anything. */
const pickOption = async (label: string, value: string, shown: string) => {
  fireEvent.change(await findHiddenSelect(label), { target: { value } });
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(
      shown,
    ),
  );
};

beforeEach(() => {
  harness.permissions = getOrganizationRolePermissions("ADMIN");
  harness.flagEnabled = true;
  modelQueries.getResolvedDefault.mockReturnValue({
    data: { model: LANGY_CONFIGURED_MODEL },
    isLoading: false,
  });
  modelQueries.modelsAllowed.mockReturnValue({
    data: { modelsAllowed: [LANGY_CONFIGURED_MODEL, "openai/gpt-5-mini"] },
    isLoading: false,
  });
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

  /** @scenario "Insights opens on an empty brief with one sentence of promise" */
  it("paints the Langy mark without the Langy panel mounted", () => {
    // Outside `.langy-root` the mark fills from an SVG gradient that only
    // the Langy panel mounts, so a viewer without Langy would see nothing.
    // Inside it the theme paints the mark in currentColor. The card must
    // therefore BE the scope, not merely sit near one.
    const { container } = renderPage(InsightsPage);
    expect(container.querySelector(".langy-root .langy-mark")).not.toBeNull();
    expect(container.querySelector(".langy-root linearGradient")).toBeNull();
  });

  /** @scenario "The inbox rail is in place at zero" */
  it("shows the five folders at zero and swaps the body per folder", () => {
    renderPage(InsightsPage);
    const rail = screen.getByRole("navigation", { name: "Insights folders" });

    // The count rides in the row's own accessible name: "Inbox 0".
    for (const label of [
      "Inbox",
      "Stale",
      "Archived",
      "Alerts",
      "Notifications",
    ]) {
      expect(
        within(rail).getByRole("button", {
          name: new RegExp(`^${label}\\s*0$`),
        }),
      ).toBeInTheDocument();
    }
    expect(within(rail).getByRole("button", { name: /Inbox/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    fireEvent.click(within(rail).getByRole("button", { name: /Stale/ }));
    expect(screen.getByText(/Nothing has gone stale/)).toBeInTheDocument();
    expect(
      screen.queryByTestId("insights-empty-brief"),
    ).not.toBeInTheDocument();

    fireEvent.click(within(rail).getByRole("button", { name: /Inbox/ }));
    expect(screen.getByTestId("insights-empty-brief")).toBeInTheDocument();
  });

  /** @scenario "Open Langy opens the Langy panel" */
  it("opens the Langy panel from Open Langy", () => {
    renderPage(InsightsPage);
    expect(useLangyStore.getState().isOpen).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open Langy" }));

    expect(useLangyStore.getState().isOpen).toBe(true);
  });

  /** @scenario "The Setup drawer keeps its edits for the sitting and never claims to save" */
  it("keeps a saved edit across close and reopen, with no confirmation", async () => {
    renderPage(InsightsPage);

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));
    expect(await findHiddenSelect("Runs")).toHaveValue("daily");
    await pickOption("Runs", "weekly", "Weekly");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.queryByLabelText("Runs")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));
    expect(await findHiddenSelect("Runs")).toHaveValue("weekly");
  });

  /** @scenario "The Model row follows Langy's configured model" */
  it("shows the model Langy is configured with, from Langy's own gate", async () => {
    renderPage(InsightsPage);

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));

    expect(await screen.findByTestId("model-selector")).toHaveValue(
      LANGY_CONFIGURED_MODEL,
    );
    expect(modelQueries.getResolvedDefault).toHaveBeenCalledWith(
      expect.objectContaining({ featureKey: "langy.chat" }),
      expect.anything(),
    );
    expect(
      screen.getByText(
        "Langy's configured model. Pick another to override it here.",
      ),
    ).toBeInTheDocument();
  });

  /** @scenario "Cancel discards the sitting's edits" */
  it("discards an edit on Cancel", async () => {
    renderPage(InsightsPage);

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));
    await pickOption("Runs", "weekly", "Weekly");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Runs")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up data" }));
    expect(await findHiddenSelect("Runs")).toHaveValue("daily");
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

    expect(hiddenSelect("Measure")).toHaveValue("requests");
    expect(hiddenSelect("Break down by")).toHaveValue("model");
    expect(hiddenSelect("Over time")).toHaveValue("day");
    expect(
      screen.getByText("usage | summarize count() by model, bin(1d)"),
    ).toBeInTheDocument();
  });
});
