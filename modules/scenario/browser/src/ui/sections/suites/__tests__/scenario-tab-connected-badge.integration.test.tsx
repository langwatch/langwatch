/**
 * The simulations page on an external set: the badge that says this tab is
 * linked to local runs, shown only to a tab the SDK opened with a key.
 * @vitest-environment jsdom
 * @see specs/scenarios/scenario-tab-handoff.feature
 */
import type * as actualModule0 from "@langwatch/browser-host/page-visibility";
import type * as actualModule1 from "@langwatch/browser-host/sse-subscription";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

vi.mock("@langwatch/browser-host/page-visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof actualModule0>();
  return { ...actual, usePageVisibility: () => true };
});
vi.mock("@langwatch/browser-host/sse-subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof actualModule1>();
  return {
    ...actual,
    useSSESubscription: () => ({
      connectionState: "connected",
      isConnected: true,
      isConnecting: false,
      hasError: false,
      isDisconnected: false,
      retryCount: 0,
      lastData: undefined,
      lastError: undefined,
    }),
  };
});

let mockQuery: Record<string, string | string[] | undefined> = {};
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    query: mockQuery,
    pathname: "/[project]/simulations/[[...path]]",
    asPath: "/my-project/simulations/python-examples",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "my-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
    setFlowCallbacks: vi.fn(),
    getFlowCallbacks: vi.fn(),
  }),
  useDrawerParams: () => ({}),
}));

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: {
    featureFlag: {
      isEnabled: { useQuery: () => ({ data: { enabled: false }, isLoading: false }) },
    },
    useUtils: () => ({
      suites: { getAll: { invalidate: vi.fn() }, getSummaries: { invalidate: vi.fn() } },
    }),
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
    suites: {
      getAll: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      getSummaries: { useQuery: () => ({ data: {}, isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      run: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    useUtils: () => ({}),
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getExternalSetSummaries: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn(), setData: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getSuiteRunData: {
        useQuery: () => ({
          data: { runs: [], scenarioSetIds: {}, hasMore: false },
          isLoading: false,
          error: null,
        }),
      },
      getSuiteRunFreshness: { useQuery: () => ({ data: undefined }) },
      getExternalSetSummaries: {
        useQuery: () => ({
          data: [
            {
              scenarioSetId: "python-examples",
              passedCount: 5,
              failedCount: 1,
              totalCount: 6,
              lastRunTimestamp: Date.now(),
            },
          ],
          isLoading: false,
          error: null,
        }),
      },
      getAll: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      cancelJob: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      cancelBatchRun: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      onSimulationUpdate: {},
    },
  },
}));

vi.mock("../run-history-panel.tsx", () => ({
  RunHistoryPanel: () => <div data-testid="all-runs-panel" />,
}));
vi.mock("../suite-detail-panel.tsx", () => ({
  SuiteDetailPanel: () => <div data-testid="suite-detail-panel" />,
  SuiteEmptyState: () => <div data-testid="suite-empty-state" />,
}));

let SimulationsPage: React.ComponentType;

describe("the simulations page on an external set", () => {
  beforeAll(async () => {
    SimulationsPage = (await import("../simulations-page.tsx")).default;
  }, 60_000);

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  describe("given the page is mounted with scenario tab key abc", () => {
    /** @scenario "A connected tab quietly shows that it is linked to local runs" */
    it("shows the connected badge in the set header and explains it on hover", async () => {
      mockQuery = { project: "my-project", path: ["python-examples"], scenarioTab: "abc" };
      renderWithDesignSystem(<SimulationsPage />);

      const badge = await screen.findByTestId("scenario-tab-connected-badge");
      expect(badge).toHaveTextContent("Connected to local run");
      expect(within(badge.parentElement!).getByText("EXTERNAL SET")).toBeInTheDocument();

      await userEvent.hover(badge);

      const explanation = await screen.findByTestId("scenario-tab-connected-popover");
      expect(explanation).toHaveTextContent(
        /when a new run starts, this view moves to it instead of opening another browser tab/,
      );
    });
  });

  describe("given the page is opened without a scenario tab key", () => {
    /** @scenario "A connected tab quietly shows that it is linked to local runs" */
    it("shows no connected badge", async () => {
      mockQuery = { project: "my-project", path: ["python-examples"] };
      renderWithDesignSystem(<SimulationsPage />);

      expect(await screen.findByText("EXTERNAL SET")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-tab-connected-badge")).not.toBeInTheDocument();
    });
  });
});
