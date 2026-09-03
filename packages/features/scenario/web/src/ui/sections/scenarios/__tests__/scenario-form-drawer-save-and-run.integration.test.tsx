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
import { setScenarioErrorHost } from "../../../../behavior/errors";

vi.mock("@langwatch/prompt-web/components/prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));
vi.mock("../scenario-editor-sidebar", () => ({
  ScenarioEditorSidebar: () => null,
}));

vi.mock("../save-and-run-menu", () => ({
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
        onClick={() => onSaveAndRun?.(selectedTarget ?? { type: "http", id: "agent-1" })}
      >
        Save and Run
      </button>
      <button data-testid="save-button" onClick={onSaveWithoutRunning}>
        Save
      </button>
    </div>
  ),
}));

// "Save and Run" no longer saves immediately — it opens a run-model dialog
// (choose user-simulator + judge models) and the real save + run happens on
// confirm (confirmRunWithModels). Stub the dialog down to a single confirm
// button so these tests exercise the save→run wiring, not the model pickers.
vi.mock("../scenario-run-model-dialog", () => ({
  ScenarioRunModelDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm?: () => void;
    onOpenChange?: (open: boolean) => void;
    simulatorModel?: string | null;
    judgeModel?: string | null;
    onSimulatorChange?: (value: string | null) => void;
    onJudgeChange?: (value: string | null) => void;
    isRunning?: boolean;
  }) =>
    open ? (
      <button data-testid="confirm-run-button" onClick={onConfirm}>
        Confirm run
      </button>
    ) : null,
}));

import { ScenarioFormDrawer } from "../scenario-form-drawer";

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

vi.mock("../../../../behavior/scenario-api", () => ({
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
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn(), setData: vi.fn() },
      },
      agents: {
        getById: { fetch: vi.fn() },
      },
    }),
  },
}));

vi.mock("@langwatch/ui-drawer", () => ({
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

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", slug: "my-project" },
    organization: { id: "org-123" },
  }),
}));

vi.mock("../../../../behavior/next-router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    pathname: "/[project]/simulations/scenarios",
    asPath: "/my-project/simulations/scenarios",
    push: mocks.mockRouterPush,
    replace: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("../../use-run-scenario", () => ({
  useRunScenario: () => ({
    runScenario: mocks.mockRunScenario,
    isRunning: false,
  }),
}));

vi.mock("../../use-scenario-target", () => ({
  useScenarioTarget: () => ({
    target: mocks.persistedTarget,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
}));

const mockToasterCreate = vi.fn();
vi.mock("@langwatch/design-system/toaster", () => ({
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
  return render(<ScenarioFormDrawer open={true} scenarioId="scenario-1" />, {
    wrapper: Wrapper,
  });
}

describe("<ScenarioFormDrawer /> save-and-run data-loss regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetByIdData = null;
    mocks.persistedTarget = null;
    mocks.mockRunScenario.mockResolvedValue(undefined);
    // A bare-Error refusal reports through the family's error host rather
    // than calling the toaster directly; bind a minimal one so that path is
    // observable the same way the direct toaster.create call sites are.
    setScenarioErrorHost({
      failed: (failure) =>
        mockToasterCreate({
          title: failure.fallbackTitle,
          description: failure.description,
          type: "error",
        }),
    } as Parameters<typeof setScenarioErrorHost>[0]);
  });

  afterEach(() => {
    cleanup();
    setScenarioErrorHost(undefined);
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

      /** @scenario "The v1 page still sends the person to the run after a single run" */
      it("calls update mutation and navigates to simulations page", async () => {
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        // "Save and Run" opens the run-model dialog; confirming it is what
        // actually saves the scenario and dispatches the run.
        await user.click(await screen.findByTestId("confirm-run-button"));

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        // confirmRunWithModels intentionally does NOT close the drawer itself — it
        // navigates and lets the route change close it (avoids a router.push race).
        expect(mocks.mockCloseDrawer).not.toHaveBeenCalled();
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

        // "Save and Run" opens the run-model dialog; confirming it is what
        // actually saves the scenario and dispatches the run.
        await user.click(await screen.findByTestId("confirm-run-button"));

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
        mocks.mockUpdateMutateAsync.mockRejectedValue(new Error("Network error"));
      });

      it("does NOT show 'Failed to run scenario' — save error must not be misreported as run failure", async () => {
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        // "Save and Run" opens the run-model dialog; confirming it is what
        // actually saves the scenario and dispatches the run.
        await user.click(await screen.findByTestId("confirm-run-button"));

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

        // "Save and Run" opens the run-model dialog; confirming it is what
        // actually saves the scenario and dispatches the run.
        await user.click(await screen.findByTestId("confirm-run-button"));

        await waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              // No handled payload on this failure, so the caller's fallback
              // names the action; a recognised code would title itself.
              title: "Couldn't save scenario",
              type: "error",
            }),
          );
        });
      });

      it("does not navigate to simulations — save must not be treated as successful", async () => {
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        // "Save and Run" opens the run-model dialog; confirming it is what
        // actually saves the scenario and dispatches the run.
        await user.click(await screen.findByTestId("confirm-run-button"));

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        expect(mocks.mockRouterPush).not.toHaveBeenCalled();
      });

      it("does not dispatch run when save failed", async () => {
        const user = userEvent.setup();
        renderEditModeDrawer();

        await user.click(screen.getByTestId("save-and-run-button"));

        // "Save and Run" opens the run-model dialog; confirming it is what
        // actually saves the scenario and dispatches the run.
        await user.click(await screen.findByTestId("confirm-run-button"));

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        expect(mocks.mockRunScenario).not.toHaveBeenCalled();
      });
    });
  });
});
