/**
 * @vitest-environment jsdom
 *
 * Integration tests for the mapping gate in ScenarioFormDrawer.
 *
 * Verifies that:
 * - Clicking Save & Run with a workflow agent that has no mappings opens the
 *   AgentWorkflowEditorDrawer instead of starting the run.
 * - Clicking Save & Run with a workflow agent that has incomplete (invalid)
 *   mappings also opens the drawer.
 * - Clicking Save & Run with a non-workflow agent (code) proceeds normally.
 *
 * @see specs/features/scenarios/workflow-agent-mapping-layer.feature
 */
import * as React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock heavy sub-components
vi.mock("../../prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));
vi.mock("../../agents/AgentTypeSelectorDrawer", () => ({
  AgentTypeSelectorDrawer: () => null,
}));
vi.mock("../ScenarioEditorSidebar", () => ({
  ScenarioEditorSidebar: () => null,
}));

// SaveAndRunMenu mock — exposes a button that calls onSaveAndRun with the
// current selectedTarget (passed in via props).
vi.mock("../SaveAndRunMenu", () => ({
  SaveAndRunMenu: ({
    onSaveAndRun,
    selectedTarget,
  }: {
    onSaveAndRun?: (target: { type: string; id: string }) => void;
    selectedTarget?: { type: string; id: string } | null;
    onSaveWithoutRunning?: () => void;
    onCreateAgent?: () => void;
    isLoading?: boolean;
    onTargetChange?: (target: unknown) => void;
    onCreatePrompt?: () => void;
  }) => (
    <div data-testid="save-and-run-menu">
      <button
        data-testid="save-and-run-button"
        onClick={() => {
          if (selectedTarget) {
            onSaveAndRun?.(selectedTarget);
          }
        }}
      >
        Save and Run
      </button>
    </div>
  ),
}));
// Auto-confirm the run-model dialog so the gate flow reaches the run; the
// dialog UI is covered in ScenarioRunModelDialog.integration.test.tsx.
vi.mock("../ScenarioRunModelDialog", () => ({
  ScenarioRunModelDialog: ({
    open,
    onConfirm,
  }: {
    open?: boolean;
    onConfirm?: () => void;
  }) => {
    React.useEffect(() => {
      if (open) onConfirm?.();
    }, [open]);
    return null;
  },
}));

import { ScenarioFormDrawer } from "../ScenarioFormDrawer";

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockUpdateMutateAsync: vi.fn(),
  mockOpenDrawer: vi.fn(),
  mockCloseDrawer: vi.fn(),
  mockRunScenario: vi.fn(),
  mockRouterPush: vi.fn(),
  mockGetByIdData: null as Record<string, unknown> | null,
  mockAgentsGetByIdFetch: vi.fn(),
  // Persisted target for useScenarioTarget — controls what selectedTarget starts as
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
            const result = { id: "new-id", ...((input as Record<string, unknown>) ?? {}) };
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
      getById: {
        // useQuery not used by ScenarioFormDrawer directly — only via utils.fetch
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
        getById: {
          fetch: mocks.mockAgentsGetByIdFetch,
        },
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

// Helpers

/** Render the drawer pre-loaded with an existing scenario and a persisted target. */
function renderWithTarget(target: { type: string; id: string }) {
  mocks.persistedTarget = target;
  mocks.mockGetByIdData = {
    id: "scenario-1",
    name: "Test Scenario",
    situation: "Test situation",
    criteria: ["Criterion"],
    labels: [],
  };
  mocks.mockUpdateMutateAsync.mockResolvedValue({
    id: "scenario-1",
    name: "Test Scenario",
    situation: "Test situation",
    criteria: ["Criterion"],
    labels: [],
  });

  return render(
    <ScenarioFormDrawer open={true} scenarioId="scenario-1" />,
    { wrapper: Wrapper },
  );
}

describe("<ScenarioFormDrawer /> mapping gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistedTarget = null;
    mocks.mockGetByIdData = null;
    mocks.mockRunScenario.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  describe("when target is a workflow agent with no scenario mappings", () => {
    beforeEach(() => {
      // Agent fetch returns a workflow agent with empty scenarioMappings
      mocks.mockAgentsGetByIdFetch.mockResolvedValue({
        id: "workflow-agent-1",
        type: "workflow",
        name: "My Workflow Agent",
        config: {
          // no scenarioMappings key
          workflow_id: "wf-123",
        },
      });
    });

    /** @scenario Opens mapping drawer when running a scenario with an unmapped workflow agent */
    it("opens the AgentWorkflowEditorDrawer instead of starting the run", async () => {
      const user = userEvent.setup();
      renderWithTarget({ type: "workflow", id: "workflow-agent-1" });

      await user.click(screen.getByTestId("save-and-run-button"));

      await waitFor(() => {
        expect(mocks.mockOpenDrawer).toHaveBeenCalledWith(
          "agentWorkflowEditor",
          { urlParams: { agentId: "workflow-agent-1" } },
        );
      });

      expect(mocks.mockRunScenario).not.toHaveBeenCalled();
    });

    it("shows a toast explaining that mappings need to be configured", async () => {
      const user = userEvent.setup();
      renderWithTarget({ type: "workflow", id: "workflow-agent-1" });

      await user.click(screen.getByTestId("save-and-run-button"));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Configure scenario mappings",
            type: "warning",
          }),
        );
      });
    });

    /** @scenario Mapping warning links back to the agent editor */
    it("offers an 'Open agent editor' action that reopens the editor drawer independently of the auto-open", async () => {
      const user = userEvent.setup();
      renderWithTarget({ type: "workflow", id: "workflow-agent-1" });

      await user.click(screen.getByTestId("save-and-run-button"));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            action: expect.objectContaining({ label: "Open agent editor" }),
          }),
        );
      });

      const toastArg = mockToasterCreate.mock.calls.at(-1)?.[0] as {
        action?: { label: string; onClick: () => void };
      };
      // AC3: the auto-open fired first (existing behavior preserved)...
      expect(mocks.mockOpenDrawer).toHaveBeenCalledWith("agentWorkflowEditor", {
        urlParams: { agentId: "workflow-agent-1" },
      });
      // ...then clear it and prove the action handler ALONE reopens the editor —
      // the fallback affordance, functional even if the auto-open was dismissed.
      mocks.mockOpenDrawer.mockClear();
      toastArg.action?.onClick();
      expect(mocks.mockOpenDrawer).toHaveBeenCalledWith("agentWorkflowEditor", {
        urlParams: { agentId: "workflow-agent-1" },
      });
    });

    /** @scenario Mapping warning names the missing scenario input field */
    it("names the missing scenario input fields (input / messages) in the toast description", async () => {
      const user = userEvent.setup();
      renderWithTarget({ type: "workflow", id: "workflow-agent-1" });

      await user.click(screen.getByTestId("save-and-run-button"));

      await waitFor(() => expect(mockToasterCreate).toHaveBeenCalled());
      const toastArg = mockToasterCreate.mock.calls.at(-1)?.[0] as {
        description?: string;
      };
      expect(toastArg.description).toMatch(/input/i);
      expect(toastArg.description).toMatch(/messages/i);
    });
  });

  describe("when target is a workflow agent with no input-field mapping", () => {
    beforeEach(() => {
      // Agent has scenarioMappings but none wire a source path to the
      // scenario "input" or "messages" field — fails hasScenarioInputMapping.
      mocks.mockAgentsGetByIdFetch.mockResolvedValue({
        id: "workflow-agent-2",
        type: "workflow",
        name: "No Input Mapping Agent",
        config: {
          workflow_id: "wf-456",
          scenarioMappings: {
            someOtherField: {
              type: "value",
              value: "hardcoded",
            },
          },
        },
      });
    });

    /** @scenario Opens mapping drawer when workflow agent has no input-field mapping */
    it("opens the AgentWorkflowEditorDrawer instead of starting the run", async () => {
      const user = userEvent.setup();
      renderWithTarget({ type: "workflow", id: "workflow-agent-2" });

      await user.click(screen.getByTestId("save-and-run-button"));

      await waitFor(() => {
        expect(mocks.mockOpenDrawer).toHaveBeenCalledWith(
          "agentWorkflowEditor",
          { urlParams: { agentId: "workflow-agent-2" } },
        );
      });

      expect(mocks.mockRunScenario).not.toHaveBeenCalled();
    });
  });

  describe("when target is a non-workflow agent (code)", () => {
    it("proceeds with the normal run without opening the mapping drawer", async () => {
      const user = userEvent.setup();
      renderWithTarget({ type: "code", id: "code-agent-1" });

      await user.click(screen.getByTestId("save-and-run-button"));

      await waitFor(() => {
        expect(mocks.mockRunScenario).toHaveBeenCalled();
      });

      expect(mocks.mockOpenDrawer).not.toHaveBeenCalledWith(
        "agentWorkflowEditor",
        expect.anything(),
      );
    });
  });

  // ── Issue #3412 — minimal input mapping ─────────────────────────────────────
  // The run gate in handleSaveAndRun already uses hasScenarioInputMapping (input
  // mapping only, no output required). This block documents that contract so a
  // future regression that adds output checks to the run gate is caught early.

  describe("when target is a workflow agent with a valid input mapping and no outputField", () => {
    beforeEach(() => {
      // Agent has scenarioMappings that satisfies hasScenarioInputMapping
      // but has NO scenarioOutputField configured.
      mocks.mockAgentsGetByIdFetch.mockResolvedValue({
        id: "workflow-agent-input-only",
        type: "workflow",
        name: "Input-Only Workflow Agent",
        config: {
          workflow_id: "wf-input-only",
          scenarioMappings: {
            userMessage: {
              type: "source",
              sourceId: "scenario",
              path: ["input"],
            },
          },
          // No scenarioOutputField — the user never configured an output
        },
      });
    });

    /** @scenario Run gate passes for workflow agent with input-only mapping */
    it("proceeds with the run without opening the mapping drawer", async () => {
      const user = userEvent.setup();
      renderWithTarget({ type: "workflow", id: "workflow-agent-input-only" });

      await user.click(screen.getByTestId("save-and-run-button"));

      await waitFor(() => {
        expect(mocks.mockRunScenario).toHaveBeenCalled();
      });

      expect(mocks.mockOpenDrawer).not.toHaveBeenCalledWith(
        "agentWorkflowEditor",
        expect.anything(),
      );
    });

    /** @scenario Run gate emits no mapping warning when input is mapped */
    it("does not show a mapping warning toast", async () => {
      const user = userEvent.setup();
      renderWithTarget({ type: "workflow", id: "workflow-agent-input-only" });

      await user.click(screen.getByTestId("save-and-run-button"));

      await waitFor(() => {
        expect(mocks.mockRunScenario).toHaveBeenCalled();
      });

      expect(mockToasterCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: "Configure scenario mappings" }),
      );
    });
  });
});
