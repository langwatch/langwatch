/**
 * @vitest-environment jsdom
 *
 * The graph composer and the alert drawer are two surfaces reading one list.
 * Saving a graph has to leave that list current, or the graph the author just
 * made is missing from the alert they came to write — with nothing on screen
 * to explain it and a page reload as the only way through.
 *
 * @see specs/automations/authoring-drawer.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationDrawer } from "~/features/automations/AutomationDrawer";
import { useAutomationStore } from "~/features/automations/state/automationStore";
import AnalyticsCustomGraph from "../index";

/** The graphs the project holds, as the server would answer. */
let serverGraphs: { id: string; name: string; graph: string }[] = [];
/** The copy the app is showing. Invalidating `graphs.getAll` is what moves
 *  the server's list into it, the way react-query's refetch does. */
let cachedGraphs: { id: string; name: string; graph: string }[] = [];

const {
  mockGraphsGetAllQuery,
  mockGraphsGetAllInvalidate,
  mockGraphsGetByIdInvalidate,
  mockCreateGraph,
  mockRouterPush,
} = vi.hoisted(() => ({
  mockGraphsGetAllQuery: vi.fn(),
  mockGraphsGetAllInvalidate: vi.fn(),
  mockGraphsGetByIdInvalidate: vi.fn(),
  mockCreateGraph: vi.fn(),
  mockRouterPush: vi.fn(),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// The chart preview renders live analytics; the composer's save path is what
// is under test, and the chart has its own tests.
vi.mock("~/components/analytics/CustomGraph", () => ({
  CustomGraph: () => null,
  summaryGraphTypes: ["summary", "pie", "donnut"],
}));

vi.mock("~/components/filters/FilterSidebar", () => ({
  FilterSidebar: () => null,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({
    filterParams: { filters: {} },
    setFilters: vi.fn(),
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { email: "me@example.com" } },
    status: "authenticated",
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: mockRouterPush }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/components/filters/FieldsFilters", () => ({
  FieldsFilters: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    graphs: {
      getAll: { useQuery: () => mockGraphsGetAllQuery() },
      getById: { useQuery: () => ({ data: null, isLoading: false }) },
      create: { useMutation: () => ({ mutate: mockCreateGraph }) },
      updateById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    // ADR-093 §5: the drawer's gated-block preview reads the project's Slack
    // connection.
    slackIntegration: {
      getStatus: {
        useQuery: () => ({ data: { connected: false }, isLoading: false }),
      },
    },
    dashboards: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    automation: {
      getTriggerById: { useQuery: () => ({ data: null, isLoading: false }) },
      testFireTemplate: { useMutation: () => ({ mutate: vi.fn() }) },
      upsert: { useMutation: () => ({ mutate: vi.fn() }) },
      getDailyCap: { useQuery: () => ({ data: undefined }) },
    },
    tracesV2: {
      list: {
        useQuery: () => ({ data: undefined, isFetching: false, error: null }),
      },
    },
    analytics: {
      getTimeseries: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
    useContext: () => ({
      automation: {
        getTriggers: { invalidate: vi.fn() },
        getTriggerById: { invalidate: vi.fn() },
      },
      graphs: {
        getAll: { invalidate: mockGraphsGetAllInvalidate },
        getById: { invalidate: mockGraphsGetByIdInvalidate },
      },
    }),
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** The alert drawer's graph picker, found by the option it always carries. */
function graphSelect(): HTMLSelectElement {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const match = selects.find((select) =>
    within(select)
      .queryAllByRole("option")
      .some((option) => /select a graph/i.test(option.textContent ?? "")),
  );
  if (!match) throw new Error("No graph select on screen");
  return match;
}

describe("Creating a custom graph then alerting on it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverGraphs = [];
    cachedGraphs = [];
    mockGraphsGetAllQuery.mockImplementation(() => ({
      data: cachedGraphs,
      isLoading: false,
    }));
    mockGraphsGetAllInvalidate.mockImplementation(() => {
      cachedGraphs = serverGraphs;
    });
    mockCreateGraph.mockImplementation(
      (
        input: { name: string },
        opts?: { onSuccess?: (created: { id: string }) => void },
      ) => {
        serverGraphs = [
          ...serverGraphs,
          { id: "graph-new", name: input.name, graph: "{}" },
        ];
        opts?.onSuccess?.({ id: "graph-new" });
      },
    );
    useAutomationStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the composer has just saved a new graph", () => {
    describe("when the author starts a new alert in the same session", () => {
      /** @scenario "A newly created graph is offered to a new alert without reloading" */
      it("offers the new graph as the graph to watch", async () => {
        const user = userEvent.setup();
        const composer = render(<AnalyticsCustomGraph />, { wrapper: Wrapper });
        await user.click(await screen.findByRole("button", { name: "Save" }));
        expect(mockCreateGraph).toHaveBeenCalledTimes(1);
        composer.unmount();

        render(<AutomationDrawer initialSource="customGraph" />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(
            within(graphSelect()).getByRole("option", {
              name: serverGraphs[0]?.name,
            }),
          ).toBeInTheDocument();
        });
      });
    });
  });
});
