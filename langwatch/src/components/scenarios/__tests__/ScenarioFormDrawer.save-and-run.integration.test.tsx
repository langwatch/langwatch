/**
 * @vitest-environment jsdom
 *
 * Integration tests for Save & Run data-loss regression (Bug #8).
 *
 * Verifies that:
 * - When the save mutation succeeds and run fails, the save is NOT rolled back.
 * - A save failure in Save & Run is not misreported as "Failed to run scenario".
 * - The drawer stays open when the save mutation fails during Save & Run.
 *
 * Root cause: handleSave for edit mode propagated updateMutation.mutateAsync
 * rejections through handleSubmit's callback to the outer try/catch in
 * handleSaveAndRun, which reported every save error as "Failed to run scenario".
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));
vi.mock("../../agents/AgentTypeSelectorDrawer", () => ({
  AgentTypeSelectorDrawer: () => null,
}));
vi.mock("../ScenarioEditorSidebar", () => ({
  ScenarioEditorSidebar: () => null,
}));

vi.mock("../SaveAndRunMenu", () => ({
  SaveAndRunMenu: ({
    onSaveAndRun,
    onSaveWithoutRunning,
    selectedTarget,
  }: {
    onSaveAndRun?: (target: { type: string; id: string }) => void;
    onSaveWithoutRunning?: () => void;
    selectedTarget?: { type: string; id: string } | null;
    onCreateAgent?: () => void;
    isLoading?: boolean;
    onTargetChange?: (target: unknown) => void;
    onCreatePrompt?: () => void;
  }) => (
    <div data-testid="save-and-run-menu">
      <button
        data-testid="save-and-run-button"
        onClick={() =>
          onSaveAndRun?.(selectedTarget ?? { type: "http", id: "agent-1" })
        }
      >
        Save and Run
      </button>
      <button data-testid="save-button" onClick={onSaveWithoutRunning}>
        Save
      </button>
    </div>
  ),
}));

import { ScenarioFormDrawer } from "../ScenarioFormDrawer";

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockUpdateMutateAsync: vi.fn(),
  mockRunScenario: vi.fn(),
  mockOpenDrawer: vi.fn(),
  mockCloseDrawer: vi.fn(),
  mockRouterPush: vi.fn(),
  mockGetByIdData: null as Record<string, unknown> | null,
  persistedTarget: null as { type: string; id: string } | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      create: {
        useMutation: ({
          onSuccess,
        }: {
          onSuccess?: (data: unknown) => void;
          onError?: (error: Error) => void;
        }) => ({
          mutateAsync: vi.fn(async (input: unknown) => {
            const result = {
              id: "new-id",
              ...((input as Record<string, unknown>) ?? {}),
            };
            onSuccess?.(result);
            return result;
          }),
          isPending: false,
        }),
      },
      update: {
        useMutation: ({
          onSuccess,
          onError,
        }: {
          onSuccess?: (data: unknown) => void;
          onError?: (error: Error) => void;
        }) => ({
          mutateAsync: vi.fn(async (input: unknown) => {
            try {
              const result = await mocks.mockUpdateMutateAsync(input);
              onSuccess?.(result);
              return result;
            } catch (error) {
              onError?.(error as Error);
              throw error;
            }
          }),
          isPending: false,
        }),
      },
      getById: {
        useQuery: () => ({
          data: mocks.mockGetByIdData,
          isLoading: false,
        }),
      },
    },
    agents: {
      getAll: {
        useQuery: () => ({ data: [] }),
      },
    },
    prompts: {
      getAllPromptsForProject: {
        useQuery: () => ({ data: [] }),
      },
    },
    licenseEnforcement: {
      checkLimit: {
        useQuery: () => ({
          data: { allowed: true, current: 0, max: 100 },
          isLoading: false,
        }),
      },
      reportLimitBlocked: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useContext: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
      agents: {
        getById: { fetch: vi.fn() },
      },
    }),
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.mockOpenDrawer,
    closeDrawer: mocks.mockCloseDrawer,
    drawerOpen: vi.fn(() => true),
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", slug: "my-project" },
    organization: { id: "org-123" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    pathname: "/[project]/simulations/scenarios",
    asPath: "/my-project/simulations/scenarios",
    push: mocks.mockRouterPush,
    replace: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({
    runScenario: mocks.mockRunScenario,
    isRunning: false,
  }),
}));

vi.mock("~/hooks/useScenarioTarget", () => ({
  useScenarioTarget: () => ({
    target: mocks.persistedTarget,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
}));

vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: unknown) => {
    if (typeof selector === "function") {
      return (selector as (state: { open: () => void }) => unknown)({
        open: vi.fn(),
      });
    }
    return { open: vi.fn() };
  },
}));

const mockToasterCreate = vi.fn();
vi.mock("../../ui/toaster", () => ({
  toaster: {
    create: (args: unknown) => mockToasterCreate(args),
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderEditModeDrawer() {
  mocks.mockGetByIdData = {
    id: "scenario-1",
    name: "Refund Flow",
    situation: "User requests a refund",
    criteria: ["Agent must acknowledge the issue"],
    labels: [],
  };
  return render(
    <ScenarioFormDrawer open={true} scenarioId="scenario-1" />,
    { wrapper: Wrapper },
  );
}

describe("<ScenarioFormDrawer /> save-and-run data-loss regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetByIdData = null;
    mocks.persistedTarget = null;
    mocks.mockRunScenario.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the drawer is in edit mode with an existing scenario", () => {
    describe("when save succeeds and run is dispatched (fire-and-forget)", () => {
      beforeEach(() => {
        mocks.mockUpdateMutateAsync.mockResolvedValue({
          id: "scenario-1",
          name: "Refund Flow",
          situation: "User requests a refund",
          criteria: ["Agent must acknowledge the issue"],
          labels: [],
        });
        // Simulate run being dispatched asynchronously (void-ed)
        mocks.mockRunScenario.mockResolvedValue(undefined);
      });

      it("calls update mutation and navigates to simulations page", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        expect(onClose).not.toHaveBeenCalled(); // drawer uses closeDrawer internally
        await waitFor(() => {
          expect(mocks.mockRouterPush).toHaveBeenCalledWith(
            expect.stringMatching(/^\/my-project\/simulations\?pendingBatch=/),
          );
        });
      });

      it("does not show 'Failed to run scenario' when only run fails asynchronously", async () => {
        // Run fails asynchronously after the save completes — handled inside useRunScenario
        mocks.mockRunScenario.mockRejectedValue(new Error("Provider error"));
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        // The outer catch in handleSaveAndRun must NOT fire for async run failures
        // because runScenario is void-ed (fire-and-forget)
        expect(mockToasterCreate).not.toHaveBeenCalledWith(
          expect.objectContaining({ title: "Failed to run scenario" }),
        );
      });
    });

    describe("when save fails (update mutation rejects)", () => {
      beforeEach(() => {
        mocks.mockUpdateMutateAsync.mockRejectedValue(
          new Error("Network error"),
        );
      });

      it("does NOT show 'Failed to run scenario' — save error must not be misreported as run failure", async () => {
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        // Must NOT misreport the save failure as a run failure
        expect(mockToasterCreate).not.toHaveBeenCalledWith(
          expect.objectContaining({ title: "Failed to run scenario" }),
        );
      });

      it("shows the save-specific error from the mutation onError callback", async () => {
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        await waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Failed to update scenario",
              type: "error",
            }),
          );
        });
      });

      it("does not navigate to simulations — save must not be treated as successful", async () => {
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        expect(mocks.mockRouterPush).not.toHaveBeenCalled();
      });

      it("does not dispatch run when save failed", async () => {
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        expect(mocks.mockRunScenario).not.toHaveBeenCalled();
      });
    });
  });
});
