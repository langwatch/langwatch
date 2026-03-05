/**
 * @vitest-environment jsdom
 *
 * Tests for evaluator local config types and EvaluatorEditorDrawer local config behavior.
 *
 * Schema tests (unit):
 * - localEvaluatorConfigSchema parses valid config
 * - localEvaluatorConfigSchema rejects invalid config (missing name)
 * - targetConfigSchema accepts localEvaluatorConfig field
 *
 * Drawer integration tests:
 * - Form initializes from initialLocalConfig when provided
 * - onLocalConfigChange is called when form changes
 * - onLocalConfigChange(undefined) is called on save success
 * - Apply button appears when onLocalConfigChange is provided
 * - Apply button does not appear when onLocalConfigChange is not provided
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  localEvaluatorConfigSchema,
  targetConfigSchema,
} from "../types";
import type { LocalEvaluatorConfig } from "../types";

// ============================================================================
// Mocks for EvaluatorEditorDrawer
// ============================================================================

// Track router state
let mockRouterQuery: Record<string, string> = {};

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    asPath: "/test",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (cb: () => void) => cb(),
    isLoading: false,
    isAllowed: true,
    limitInfo: { allowed: true, current: 2, max: 5 },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => undefined,
  getDrawerStack: () => [],
  setFlowCallbacks: vi.fn(),
}));

vi.mock("~/hooks/useProjectSpanNames", () => ({
  useProjectSpanNames: () => ({ spanNames: [], metadataKeys: [] }),
}));

// Mock evaluator data returned by the API
const mockEvaluatorData = {
  id: "eval-1",
  name: "Exact Match",
  type: "evaluator",
  projectId: "test-project",
  config: {
    evaluatorType: "langevals/exact_match",
    settings: { maxScore: 1 },
  },
  fields: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Store reference to mutation callbacks for testing
let _updateMutationOnSuccess:
  | ((data: typeof mockEvaluatorData) => void)
  | undefined;

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      evaluators: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
    publicEnv: {
      useQuery: () => ({
        data: { IS_SAAS: false },
        isLoading: false,
      }),
    },
    evaluators: {
      getById: {
        useQuery: ({ id }: { id: string }) => ({
          data: id ? mockEvaluatorData : null,
          isLoading: false,
        }),
      },
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      update: {
        useMutation: (callbacks?: {
          onSuccess?: (data: typeof mockEvaluatorData) => void;
        }) => {
          _updateMutationOnSuccess = callbacks?.onSuccess;
          return {
            mutate: () => {
              // Simulate successful save
              callbacks?.onSuccess?.(mockEvaluatorData);
            },
            isPending: false,
          };
        },
      },
    },
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// ============================================================================
// Schema Tests (Unit)
// ============================================================================

describe("localEvaluatorConfigSchema", () => {
  describe("when given a valid config", () => {
    it("parses successfully with name and settings", () => {
      const config = {
        name: "My Evaluator",
        settings: { threshold: 0.8, model: "gpt-4" },
      };
      const result = localEvaluatorConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Evaluator");
        expect(result.data.settings).toEqual({
          threshold: 0.8,
          model: "gpt-4",
        });
      }
    });

    it("parses successfully with name only (settings optional)", () => {
      const config = { name: "Simple Evaluator" };
      const result = localEvaluatorConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Simple Evaluator");
        expect(result.data.settings).toBeUndefined();
      }
    });
  });

  describe("when given an invalid config", () => {
    it("rejects config missing name", () => {
      const config = { settings: { threshold: 0.8 } };
      const result = localEvaluatorConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("rejects config with non-string name", () => {
      const config = { name: 123 };
      const result = localEvaluatorConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});

describe("targetConfigSchema", () => {
  describe("when given localEvaluatorConfig", () => {
    it("accepts a target config with localEvaluatorConfig field", () => {
      const target = {
        id: "target-1",
        type: "evaluator",
        mappings: {},
        localEvaluatorConfig: {
          name: "Modified Evaluator",
          settings: { threshold: 0.5 },
        },
      };
      const result = targetConfigSchema.safeParse(target);
      expect(result.success).toBe(true);
    });

    it("accepts a target config without localEvaluatorConfig (optional)", () => {
      const target = {
        id: "target-1",
        type: "evaluator",
        mappings: {},
      };
      const result = targetConfigSchema.safeParse(target);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// EvaluatorEditorDrawer Local Config Tests (Integration)
// ============================================================================

describe("<EvaluatorEditorDrawer />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterQuery = {};
    _updateMutationOnSuccess = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when initialLocalConfig is provided", () => {
    it("initializes form with local config values instead of DB data", async () => {
      const { EvaluatorEditorDrawer } = await import(
        "~/components/evaluators/EvaluatorEditorDrawer"
      );

      const localConfig: LocalEvaluatorConfig = {
        name: "Modified Evaluator Name",
        settings: { maxScore: 0.5 },
      };

      render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-1"
          initialLocalConfig={localConfig}
          onLocalConfigChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Wait for form to render with local config values
      await waitFor(
        () => {
          const nameInput = screen.getByTestId("evaluator-name-input");
          expect(nameInput).toHaveValue("Modified Evaluator Name");
        },
        { timeout: 5000 },
      );
    }, 15000);
  });

  describe("when form changes are made", () => {
    it("calls onLocalConfigChange with updated values", async () => {
      const user = userEvent.setup({ delay: null });
      const { EvaluatorEditorDrawer } = await import(
        "~/components/evaluators/EvaluatorEditorDrawer"
      );

      const mockOnLocalConfigChange = vi.fn();

      render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-1"
          onLocalConfigChange={mockOnLocalConfigChange}
        />,
        { wrapper: Wrapper },
      );

      // Wait for form to render with DB data
      await waitFor(
        () => {
          const nameInput = screen.getByTestId("evaluator-name-input");
          expect(nameInput).toHaveValue("Exact Match");
        },
        { timeout: 5000 },
      );

      // Append text to the name field (avoid clear to prevent intermediate empty state)
      const nameInput = screen.getByTestId("evaluator-name-input");
      await user.type(nameInput, " Modified");

      // Wait for debounced callback to fire with the modified name
      await waitFor(
        () => {
          const calls = mockOnLocalConfigChange.mock.calls as Array<
            [LocalEvaluatorConfig | undefined]
          >;
          const callsWithConfig = calls.filter(
            (call) =>
              call[0] !== undefined && call[0]?.name?.includes("Modified"),
          );
          expect(callsWithConfig.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      // Verify the most recent config call includes the appended text
      const calls = mockOnLocalConfigChange.mock.calls as Array<
        [LocalEvaluatorConfig | undefined]
      >;
      const lastCallWithConfig = calls
        .filter(
          (call) =>
            call[0] !== undefined && call[0]?.name?.includes("Modified"),
        )
        .pop();
      expect(lastCallWithConfig?.[0]?.name).toBe("Exact Match Modified");
    }, 15000);
  });

  describe("when save succeeds", () => {
    it("calls onLocalConfigChange with undefined to clear local config", async () => {
      const user = userEvent.setup({ delay: null });
      const { EvaluatorEditorDrawer } = await import(
        "~/components/evaluators/EvaluatorEditorDrawer"
      );

      const mockOnLocalConfigChange = vi.fn();
      const localConfig: LocalEvaluatorConfig = {
        name: "Unsaved Changes",
        settings: { maxScore: 0.5 },
      };

      render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-1"
          evaluatorType="langevals/exact_match"
          initialLocalConfig={localConfig}
          onLocalConfigChange={mockOnLocalConfigChange}
        />,
        { wrapper: Wrapper },
      );

      // Wait for form to render
      await waitFor(
        () => {
          const nameInput = screen.getByTestId("evaluator-name-input");
          expect(nameInput).toHaveValue("Unsaved Changes");
        },
        { timeout: 5000 },
      );

      // Click save button
      const saveButton = screen.getByTestId("evaluator-save-button");
      await user.click(saveButton);

      // Wait for onLocalConfigChange to be called with undefined (clearing local config)
      await waitFor(
        () => {
          const calls = mockOnLocalConfigChange.mock.calls as Array<
            [LocalEvaluatorConfig | undefined]
          >;
          const undefinedCalls = calls.filter((call) => call[0] === undefined);
          expect(undefinedCalls.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );
    }, 15000);
  });

  describe("when onLocalConfigChange is provided", () => {
    it("renders the Apply button", async () => {
      const { EvaluatorEditorDrawer } = await import(
        "~/components/evaluators/EvaluatorEditorDrawer"
      );

      render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-1"
          onLocalConfigChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Wait for drawer to render
      await waitFor(
        () => {
          const applyButton = screen.getByTestId("evaluator-apply-button");
          expect(applyButton).toBeInTheDocument();
        },
        { timeout: 5000 },
      );
    }, 15000);

    it("does NOT show save confirmation when closing with unsaved changes", async () => {
      const user = userEvent.setup({ delay: null });
      const { EvaluatorEditorDrawer } = await import(
        "~/components/evaluators/EvaluatorEditorDrawer"
      );

      vi.spyOn(window, "confirm").mockImplementation(() => true);

      const localConfig: LocalEvaluatorConfig = {
        name: "Unsaved Changes",
      };

      render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-1"
          initialLocalConfig={localConfig}
          onLocalConfigChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Wait for form to render
      await waitFor(
        () => {
          expect(
            screen.getByTestId("evaluator-name-input"),
          ).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Close the drawer using Escape key
      await user.keyboard("{Escape}");

      // window.confirm should NOT be called because onLocalConfigChange is provided
      expect(window.confirm).not.toHaveBeenCalled();
    }, 15000);
  });

  describe("when onLocalConfigChange is NOT provided", () => {
    it("does NOT render the Apply button", async () => {
      const { EvaluatorEditorDrawer } = await import(
        "~/components/evaluators/EvaluatorEditorDrawer"
      );

      render(
        <EvaluatorEditorDrawer
          open={true}
          evaluatorId="eval-1"
          // No onLocalConfigChange
        />,
        { wrapper: Wrapper },
      );

      // Wait for drawer to render
      await waitFor(
        () => {
          expect(
            screen.getByTestId("save-evaluator-button"),
          ).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Apply button should NOT be present
      expect(
        screen.queryByTestId("evaluator-apply-button"),
      ).not.toBeInTheDocument();
    }, 15000);
  });
});
