/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioFormDrawer deferred persistence.
 *
 * Verifies that:
 * - Opening the drawer without a scenarioId does not create a DB record
 * - First save creates the record and transitions to edit mode
 * - Subsequent saves update the existing record
 * - Closing without saving abandons the draft
 *
 * @see specs/scenarios/scenario-deferred-persistence.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock heavy sub-components that pull in generated types
vi.mock("../../agents/AgentHttpEditorDrawer", () => ({
  AgentHttpEditorDrawer: () => null,
}));
vi.mock("../../prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));
vi.mock("../SaveAndRunMenu", () => ({
  SaveAndRunMenu: ({
    onSaveWithoutRunning,
    onSaveAndRun,
    selectedTarget,
  }: {
    onSaveWithoutRunning?: () => void;
    onSaveAndRun?: (target: { type: string; id: string }) => void;
    selectedTarget?: { type: string; id: string } | null;
  }) => (
    <div data-testid="save-and-run-menu">
      <button data-testid="save-button" onClick={onSaveWithoutRunning}>
        Save
      </button>
      <button
        data-testid="save-and-run-button"
        onClick={() =>
          onSaveAndRun?.(selectedTarget ?? { type: "http", id: "agent-1" })
        }
      >
        Save and Run
      </button>
    </div>
  ),
}));
vi.mock("../ScenarioEditorSidebar", () => ({
  ScenarioEditorSidebar: () => null,
}));

import { ScenarioFormDrawer } from "../ScenarioFormDrawer";

// -- Hoisted mocks --

const mocks = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDrawerParams: {} as Record<string, string | undefined>,
  mockComplexProps: {} as Record<string, unknown>,
  mockOpenDrawer: vi.fn(),
  mockCloseDrawer: vi.fn(),
  mockRunScenario: vi.fn(),
  mockGetByIdData: null as { id: string; name: string; situation: string; criteria: string[]; labels: string[] } | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      create: {
        useMutation: ({ onSuccess, onError }: { onSuccess?: (data: unknown) => void; onError?: (error: Error) => void }) => ({
          mutateAsync: vi.fn(async (input: unknown) => {
            try {
              const result = await mocks.mockCreateMutateAsync(input);
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
      update: {
        useMutation: ({ onSuccess, onError }: { onSuccess?: (data: unknown) => void; onError?: (error: Error) => void }) => ({
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
    },
    useContext: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
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
  useDrawerParams: () => mocks.mockDrawerParams,
  getComplexProps: () => mocks.mockComplexProps,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", slug: "my-project" },
    organization: { id: "org-123" },
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
    target: null,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
}));

// Mock upgrade modal store (used by useLicenseEnforcement)
vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: unknown) => {
    if (typeof selector === "function") {
      return (selector as (state: { open: () => void }) => unknown)({ open: vi.fn() });
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

describe("<ScenarioFormDrawer/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockDrawerParams = {};
    mocks.mockComplexProps = {};
    mocks.mockGetByIdData = null;
    mocks.mockCreateMutateAsync.mockResolvedValue({
      id: "new-scenario-id",
      name: "Refund Request Test",
      situation: "User requests a refund",
      criteria: ["Agent acknowledges the issue"],
      labels: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when opened without a scenarioId (create mode)", () => {
    it("displays 'Create Scenario' heading", () => {
      render(<ScenarioFormDrawer open={true} />, { wrapper: Wrapper });

      expect(screen.getByText("Create Scenario")).toBeInTheDocument();
    });

    it("does not call create mutation on open", () => {
      render(<ScenarioFormDrawer open={true} />, { wrapper: Wrapper });

      expect(mocks.mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    describe("when initialFormData is provided via complexProps", () => {
      beforeEach(() => {
        mocks.mockComplexProps = {
          initialFormData: {
            name: "Generated Scenario",
            situation: "A generated situation",
            criteria: ["Criterion 1"],
            labels: [],
          },
        };
      });

      it("pre-populates the form with initial data", () => {
        render(<ScenarioFormDrawer open={true} />, { wrapper: Wrapper });

        expect(screen.getByDisplayValue("Generated Scenario")).toBeInTheDocument();
        expect(screen.getByDisplayValue("A generated situation")).toBeInTheDocument();
      });

      it("does not create a DB record", () => {
        render(<ScenarioFormDrawer open={true} />, { wrapper: Wrapper });

        expect(mocks.mockCreateMutateAsync).not.toHaveBeenCalled();
      });
    });

    describe("when user saves the form without running", () => {
      beforeEach(() => {
        mocks.mockComplexProps = {
          initialFormData: {
            name: "Refund Request Test",
            situation: "User requests a refund",
            criteria: ["Agent acknowledges the issue"],
            labels: [],
          },
        };
      });

      it("closes the drawer after successful create", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();

        render(<ScenarioFormDrawer open={true} onClose={onClose} />, { wrapper: Wrapper });

        const saveButton = screen.getByTestId("save-button");
        await user.click(saveButton);

        await waitFor(() => {
          expect(mocks.mockCreateMutateAsync).toHaveBeenCalledTimes(1);
        });

        await waitFor(() => {
          expect(onClose).toHaveBeenCalledTimes(1);
        });
      });

      it("does not transition to edit mode when save-without-running", async () => {
        const user = userEvent.setup();

        render(<ScenarioFormDrawer open={true} onClose={vi.fn()} />, { wrapper: Wrapper });

        const saveButton = screen.getByTestId("save-button");
        await user.click(saveButton);

        await waitFor(() => {
          expect(mocks.mockCreateMutateAsync).toHaveBeenCalledTimes(1);
        });

        expect(mocks.mockOpenDrawer).not.toHaveBeenCalled();
      });
    });

    describe("when drawer is closed without saving", () => {
      it("does not create a DB record", () => {
        const { unmount } = render(<ScenarioFormDrawer open={true} />, {
          wrapper: Wrapper,
        });

        // Close the drawer without saving
        unmount();

        expect(mocks.mockCreateMutateAsync).not.toHaveBeenCalled();
      });
    });
  });

  describe("when opened with a scenarioId (edit mode)", () => {
    beforeEach(() => {
      mocks.mockDrawerParams = { scenarioId: "existing-scenario-id" };
      mocks.mockGetByIdData = {
        id: "existing-scenario-id",
        name: "Existing Scenario",
        situation: "Existing situation",
        criteria: ["Existing criterion"],
        labels: ["billing"],
      };
      mocks.mockUpdateMutateAsync.mockResolvedValue({
        id: "existing-scenario-id",
        name: "Existing Scenario",
        situation: "Existing situation",
        criteria: ["Existing criterion"],
        labels: ["billing"],
      });
    });

    it("displays 'Edit Scenario' heading", () => {
      render(<ScenarioFormDrawer open={true} />, { wrapper: Wrapper });

      expect(screen.getByText("Edit Scenario")).toBeInTheDocument();
    });

    describe("when user saves without running", () => {
      it("closes the drawer after successful update", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();

        render(<ScenarioFormDrawer open={true} onClose={onClose} />, { wrapper: Wrapper });

        const saveButton = screen.getByTestId("save-button");
        await user.click(saveButton);

        await waitFor(() => {
          expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        });

        await waitFor(() => {
          expect(onClose).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  describe("when save fails", () => {
    beforeEach(() => {
      mocks.mockDrawerParams = { scenarioId: "existing-scenario-id" };
      mocks.mockGetByIdData = {
        id: "existing-scenario-id",
        name: "Existing Scenario",
        situation: "Existing situation",
        criteria: ["Existing criterion"],
        labels: ["billing"],
      };
      mocks.mockUpdateMutateAsync.mockRejectedValue(
        new Error("Network error")
      );
    });

    it("keeps the drawer open", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<ScenarioFormDrawer open={true} onClose={onClose} />, { wrapper: Wrapper });

      const saveButton = screen.getByTestId("save-button");
      await user.click(saveButton);

      await waitFor(() => {
        expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
      });

      // Drawer should remain open - onClose should not be called
      expect(onClose).not.toHaveBeenCalled();
    });

    it("displays an error message", async () => {
      const user = userEvent.setup();

      render(<ScenarioFormDrawer open={true} onClose={vi.fn()} />, { wrapper: Wrapper });

      const saveButton = screen.getByTestId("save-button");
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to update scenario",
            type: "error",
          })
        );
      });
    });
  });

  describe("when user clicks save-and-run", () => {
    beforeEach(() => {
      mocks.mockDrawerParams = { scenarioId: "existing-scenario-id" };
      mocks.mockGetByIdData = {
        id: "existing-scenario-id",
        name: "Refund Flow",
        situation: "User requests a refund",
        criteria: ["Agent acknowledges the issue"],
        labels: [],
      };
      mocks.mockUpdateMutateAsync.mockResolvedValue({
        id: "existing-scenario-id",
        name: "Refund Flow",
        situation: "User requests a refund",
        criteria: ["Agent acknowledges the issue"],
        labels: [],
      });
      mocks.mockRunScenario.mockResolvedValue(undefined);
    });

    it("keeps the drawer open", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<ScenarioFormDrawer open={true} onClose={onClose} />, { wrapper: Wrapper });

      const saveAndRunButton = screen.getByTestId("save-and-run-button");
      await user.click(saveAndRunButton);

      await waitFor(() => {
        expect(mocks.mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
      });

      // Drawer should remain open after save-and-run
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
