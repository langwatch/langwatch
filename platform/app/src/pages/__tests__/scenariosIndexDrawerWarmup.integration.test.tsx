/**
 * @vitest-environment jsdom
 *
 * The scenario library's rows open the scenario editor, which is a separate
 * download. Without a warm-up the click shows the drawer spinner while the
 * browser fetches the code.
 *
 * specs/navigation/drawer-chunk-warmup.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { preloadDrawer } = vi.hoisted(() => ({
  preloadDrawer: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/components/drawerRegistry", () => ({ preloadDrawer }));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), back: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    project: { id: "proj-1", slug: "test-project" },
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: (props: P) => ReactNode) =>
    (props: P) =>
      Component(props),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/scenarios/ScenarioCreateModal", () => ({
  ScenarioCreateModal: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ scenarios: { getAll: { invalidate: vi.fn() } } }),
    scenarios: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "scenario-1",
              name: "Refund Request Test",
              labels: ["quality"],
              updatedAt: new Date("2026-07-23T16:03:00Z"),
            },
          ],
          isLoading: false,
          error: null,
        }),
      },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      batchArchive: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

const ScenarioLibraryPage = (
  await import("../[project]/simulations/scenarios/index")
).default;

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

describe("Scenario library page", () => {
  describe("given the scenario library is on screen", () => {
    describe("when the browser becomes idle", () => {
      /** @scenario "The scenario library warms the scenario editor" */
      it("fetches the scenario editor's code", () => {
        render(
          <ChakraProvider value={defaultSystem}>
            <ScenarioLibraryPage />
          </ChakraProvider>,
        );

        becomeIdle();

        expect(preloadDrawer).toHaveBeenCalledWith("scenarioEditor");
      });
    });
  });
});
