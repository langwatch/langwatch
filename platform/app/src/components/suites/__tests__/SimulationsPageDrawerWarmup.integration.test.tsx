/**
 * @vitest-environment jsdom
 *
 * The runs page opens two drawers: a run's detail from the rows, and the run
 * plan editor from the sidebar. Both are separate downloads, so without a
 * warm-up the click waits for the network with only the drawer spinner on
 * screen.
 *
 * specs/navigation/drawer-chunk-warmup.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SimulationsPage from "~/components/suites/SimulationsPage";

const { preloadDrawer } = vi.hoisted(() => ({
  preloadDrawer: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/components/drawerRegistry", () => ({ preloadDrawer }));

vi.mock("~/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      suites: {
        getAll: { invalidate: vi.fn() },
        getSummaries: { invalidate: vi.fn() },
      },
    }),
    suites: {
      getAll: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      getSummaries: { useQuery: () => ({ data: {}, isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      run: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scenarios: {
      getSuiteRunData: {
        useQuery: () => ({
          data: { runs: [], scenarioSetIds: {}, hasMore: false },
          isLoading: false,
          error: null,
        }),
      },
      getExternalSetSummaries: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      getAll: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      cancelJob: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      cancelBatchRun: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "my-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), setFlowCallbacks: vi.fn() }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    pathname: "/[project]/simulations/[[...path]]",
    asPath: "/my-project/simulations",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: () => {},
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/suites/RunHistoryPanel", () => ({
  RunHistoryPanel: () => <div />,
}));

let idleCallbacks: Array<(() => void) | undefined> = [];

const becomeIdle = () => {
  for (const callback of idleCallbacks) callback?.();
};

beforeEach(() => {
  preloadDrawer.mockClear();
  idleCallbacks = [];
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });
  vi.stubGlobal("cancelIdleCallback", (handle: number) => {
    idleCallbacks[handle - 1] = undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Runs page", () => {
  describe("given the runs page is on screen", () => {
    describe("when the browser becomes idle", () => {
      /** @scenario "The runs page warms the drawers its rows and sidebar open" */
      it("fetches the code of the run detail and the run plan editor", () => {
        render(
          <ChakraProvider value={defaultSystem}>
            <SimulationsPage />
          </ChakraProvider>,
        );

        becomeIdle();

        expect(preloadDrawer).toHaveBeenCalledWith("scenarioRunDetail");
        expect(preloadDrawer).toHaveBeenCalledWith("suiteEditor");
      });
    });
  });
});
