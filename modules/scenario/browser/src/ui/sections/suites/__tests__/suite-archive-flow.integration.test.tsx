/**
 * The archive flow of the Suites page: right-click, confirm in the dialog, then the suite is gone.
 * @vitest-environment jsdom
 * @see specs/features/suites/suite-archive-confirmation-dialog.feature
 */
import type * as actualModule from "@langwatch/browser-host/sse-subscription";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("@langwatch/browser-host/sse-subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof actualModule>();
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

let capturedArchiveOnSuccess: (() => void) | undefined;
const archiveMutate = vi.fn();

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: {
    featureFlag: {
      isEnabled: {
        useQuery: () => ({ data: { enabled: false }, isLoading: false }),
      },
    },
    useUtils: () => ({
      suites: {
        getAll: { invalidate: vi.fn() },
        getSummaries: { invalidate: vi.fn() },
      },
    }),
    suites: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "suite_1",
              projectId: "project_1",
              name: "My Suite",
              slug: "my-suite",
              description: null,
              scenarioIds: [],
              targets: [],
              repeatCount: 1,
              labels: [],
              simulatorModel: null,
              judgeModel: null,
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          isLoading: false,
          error: null,
        }),
      },
      archive: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          capturedArchiveOnSuccess = opts.onSuccess;
          return { mutate: archiveMutate, isPending: false };
        },
      },
      duplicate: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      getSummaries: {
        useQuery: () => ({ data: {}, isLoading: false }),
      },
      run: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getExternalSetSummaries: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      getSuiteRunData: {
        useQuery: () => ({
          data: {
            runs: [],
            scenarioSetIds: {},
            hasMore: false,
            nextCursor: undefined,
          },
          isLoading: false,
          error: null,
        }),
      },
      getExternalSetSummaries: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      cancelJob: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
      cancelBatchRun: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
    },
  },
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
    setFlowCallbacks: vi.fn(),
  }),
}));

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockRouterQuery: Record<string, string | string[] | undefined> = {
  project: "my-project",
};
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    pathname: "/[project]/simulations/[[...path]]",
    asPath: "/my-project/simulations",
    push: mockPush,
    replace: mockReplace,
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

// Mock panels to avoid deep dependency trees
vi.mock("../run-history-panel.tsx", () => ({
  RunHistoryPanel: () => <div data-testid="all-runs-panel">All Runs Panel</div>,
}));

vi.mock("../suite-detail-panel.tsx", () => ({
  SuiteDetailPanel: ({ suite }: { suite: { name: string } }) => (
    <div data-testid="suite-detail-panel">{suite.name}</div>
  ),
  SuiteEmptyState: () => <div data-testid="suite-empty-state">Empty</div>,
}));

describe("Archiving a suite from the Suites page", () => {
  let SimulationsPage: React.ComponentType;

  beforeAll(async () => {
    SimulationsPage = (await import("../simulations-page.tsx")).default;
  }, 60_000);

  beforeEach(() => {
    mockRouterQuery = { project: "my-project" };
    archiveMutate.mockClear();
  });

  afterEach(() => {
    cleanup();
    capturedArchiveOnSuccess = undefined;
  });

  async function openArchiveDialog() {
    renderWithDesignSystem(<SimulationsPage />);
    const user = userEvent.setup();
    act(() => {
      fireEvent.contextMenu(screen.getAllByText("My Suite")[0]!);
    });
    await user.click(screen.getByText("Archive"));
    return { user, dialog: await screen.findByRole("dialog") };
  }

  describe("given the archive confirmation dialog is open", () => {
    /** @scenario Cancel dismisses the archive confirmation dialog without archiving */
    it("closes on Cancel, archives nothing and leaves the suite in the sidebar", async () => {
      const { user, dialog } = await openArchiveDialog();
      expect(within(dialog).getByText("My Suite")).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(archiveMutate).not.toHaveBeenCalled();
      expect(screen.getAllByText("My Suite").length).toBeGreaterThan(0);
    });

    /** @scenario Confirm archives the suite */
    it("archives the suite on Archive and closes once the archive lands", async () => {
      const { user, dialog } = await openArchiveDialog();

      await user.click(within(dialog).getByRole("button", { name: "Archive" }));

      expect(archiveMutate).toHaveBeenCalledWith({ projectId: "project_1", id: "suite_1" });

      act(() => {
        capturedArchiveOnSuccess?.();
      });

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
  });
});
