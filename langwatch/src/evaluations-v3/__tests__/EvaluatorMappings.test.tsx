/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock optimization_studio hooks to prevent circular dependency issues
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import { RunEvaluationButton } from "../components/RunEvaluationButton";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { EvaluatorConfig, TargetConfig, DatasetReference } from "../types";

// Track opened drawer
let openedDrawerType: string | null = null;
let openedDrawerParams: Record<string, unknown> = {};

// Mock dependencies
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn((type: string, params: Record<string, unknown>) => {
      openedDrawerType = type;
      openedDrawerParams = params ?? {};
    }),
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

// Mock useLatestPromptVersion to avoid needing SessionProvider
vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

// Mock api
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      agents: {
        getById: {
          fetch: vi.fn(),
        },
      },
      prompts: {
        getByIdOrHandle: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
      evaluators: {
        getById: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
    }),
    datasetRecord: {
      getAll: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
      update: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
      deleteMany: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
    },
    agents: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    evaluators: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
  },
}));

// Mock drawer components
vi.mock("~/components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: () => null,
}));
vi.mock("~/components/agents/AgentListDrawer", () => ({
  AgentListDrawer: () => null,
}));
vi.mock("~/components/agents/AgentTypeSelectorDrawer", () => ({
  AgentTypeSelectorDrawer: () => null,
}));
vi.mock("~/components/agents/AgentCodeEditorDrawer", () => ({
  AgentCodeEditorDrawer: () => null,
}));
vi.mock("~/components/agents/WorkflowSelectorDrawer", () => ({
  WorkflowSelectorDrawer: () => null,
}));
vi.mock("~/components/targets/TargetTypeSelectorDrawer", () => ({
  TargetTypeSelectorDrawer: () => null,
}));
vi.mock("~/components/prompts/PromptListDrawer", () => ({
  PromptListDrawer: () => null,
}));
vi.mock("~/components/evaluators/EvaluatorListDrawer", () => ({
  EvaluatorListDrawer: () => null,
}));
vi.mock("~/components/evaluators/EvaluatorCategorySelectorDrawer", () => ({
  EvaluatorCategorySelectorDrawer: () => null,
}));
vi.mock("~/components/evaluators/EvaluatorTypeSelectorDrawer", () => ({
  EvaluatorTypeSelectorDrawer: () => null,
}));
vi.mock("~/components/evaluators/EvaluatorEditorDrawer", () => ({
  EvaluatorEditorDrawer: () => null,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Helper to create test data
const createTestTarget = (overrides?: Partial<TargetConfig>): TargetConfig => ({
  id: "target-1",
  type: "prompt",
  name: "Test Target",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
  ...overrides,
});

const createTestDataset = (overrides?: Partial<DatasetReference>): DatasetReference => ({
  id: "test-data",
  name: "Test Data",
  type: "inline",
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
  inline: {
    columns: [
      { id: "input", name: "input", type: "string" },
      { id: "expected_output", name: "expected_output", type: "string" },
    ],
    records: { input: ["test"], expected_output: ["expected"] },
  },
  ...overrides,
});

const createTestEvaluator = (overrides?: Partial<EvaluatorConfig>): EvaluatorConfig => ({
  id: "evaluator-1",
  evaluatorType: "langevals/exact_match",
  name: "Exact Match",
  settings: {},
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  mappings: {},
  dbEvaluatorId: "db-eval-1",
  ...overrides,
});

describe("Evaluator Mappings", () => {
  beforeEach(() => {
    openedDrawerType = null;
    openedDrawerParams = {};
    vi.clearAllMocks();

    // Reset store state
    const store = useEvaluationsV3Store.getState();
    store.reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Auto-inference of mappings", () => {
    it("auto-infers evaluator mappings when evaluator is added", async () => {
      // Set up store with target and dataset
      useEvaluationsV3Store.setState({
        targets: [createTestTarget()],
        datasets: [createTestDataset()],
        activeDatasetId: "test-data",
        evaluators: [],
      });

      // Add an evaluator
      const store = useEvaluationsV3Store.getState();
      store.addEvaluator(createTestEvaluator());

      // Check that mappings were inferred
      const updatedStore = useEvaluationsV3Store.getState();
      const evaluator = updatedStore.evaluators[0];
      expect(evaluator).toBeDefined();

      const datasetMappings = evaluator?.mappings["test-data"]?.["target-1"];

      // "output" should be mapped to target output (prioritized for "output" field)
      const outputMapping = datasetMappings?.output;
      expect(outputMapping).toBeDefined();
      expect(outputMapping?.type).toBe("source");
      if (outputMapping?.type === "source") {
        expect(outputMapping.source).toBe("target");
        expect(outputMapping.sourceField).toBe("output");
      }

      // "expected_output" should be mapped to dataset (prioritized for non-"output" fields)
      const expectedOutputMapping = datasetMappings?.expected_output;
      expect(expectedOutputMapping).toBeDefined();
      expect(expectedOutputMapping?.type).toBe("source");
      if (expectedOutputMapping?.type === "source") {
        expect(expectedOutputMapping.source).toBe("dataset");
        expect(expectedOutputMapping.sourceField).toBe("expected_output");
      }
    });

    it("auto-infers evaluator mappings when new target is added", async () => {
      // Set up store with dataset and evaluator
      useEvaluationsV3Store.setState({
        targets: [],
        datasets: [createTestDataset()],
        activeDatasetId: "test-data",
        evaluators: [createTestEvaluator()],
      });

      // Add a target
      const store = useEvaluationsV3Store.getState();
      store.addTarget(createTestTarget());

      // Check that evaluator mappings were inferred for the new target
      const updatedStore = useEvaluationsV3Store.getState();
      const evaluator = updatedStore.evaluators[0];
      expect(evaluator).toBeDefined();

      const datasetMappings = evaluator?.mappings["test-data"]?.["target-1"];
      expect(datasetMappings?.expected_output).toBeDefined();
    });
  });

  describe("Missing mapping alert icon", () => {
    it("shows alert icon when evaluator has missing mappings", async () => {
      // Set up store with target, dataset, and evaluator WITHOUT auto-inferred mappings
      useEvaluationsV3Store.setState({
        targets: [createTestTarget()],
        datasets: [createTestDataset()],
        activeDatasetId: "test-data",
        evaluators: [
          createTestEvaluator({
            // No mappings - will show as missing
            mappings: {},
          }),
        ],
      });

      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // Wait for the table to render (multiple instances, one per row)
      await waitFor(() => {
        expect(screen.getAllByText("Exact Match").length).toBeGreaterThan(0);
      });

      // Look for the alert icon (there may be multiple, one per row)
      const alertIcons = screen.getAllByTestId("evaluator-missing-mapping-alert-evaluator-1");
      expect(alertIcons.length).toBeGreaterThan(0);
    });

    it("hides alert icon when evaluator has all mappings", async () => {
      // Set up store with complete mappings
      useEvaluationsV3Store.setState({
        targets: [createTestTarget()],
        datasets: [createTestDataset()],
        activeDatasetId: "test-data",
        evaluators: [
          createTestEvaluator({
            mappings: {
              "test-data": {
                "target-1": {
                  output: {
                    type: "source",
                    source: "target",
                    sourceId: "target-1",
                    sourceField: "output",
                  },
                  expected_output: {
                    type: "source",
                    source: "dataset",
                    sourceId: "test-data",
                    sourceField: "expected_output",
                  },
                },
              },
            },
          }),
        ],
      });

      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // Wait for the table to render
      await waitFor(() => {
        expect(screen.getAllByText("Exact Match").length).toBeGreaterThan(0);
      });

      // Alert icon should not be present
      const alertIcons = screen.queryAllByTestId("evaluator-missing-mapping-alert-evaluator-1");
      expect(alertIcons.length).toBe(0);
    });

    it("hides alert icon when optional fields are missing but all required are mapped", async () => {
      // langevals/llm_answer_match has requiredFields: ["output", "expected_output"], optionalFields: ["input"]
      // Both required fields are mapped, optional "input" is not - should be valid
      useEvaluationsV3Store.setState({
        targets: [createTestTarget()],
        datasets: [createTestDataset()],
        activeDatasetId: "test-data",
        evaluators: [
          {
            id: "evaluator-1",
            evaluatorType: "langevals/llm_answer_match" as const,
            name: "LLM Answer Match",
            settings: {},
            inputs: [
              { identifier: "output", type: "str" as const },
              { identifier: "expected_output", type: "str" as const },
              { identifier: "input", type: "str" as const }, // Optional field
            ],
            mappings: {
              "test-data": {
                "target-1": {
                  // Required fields are mapped
                  output: {
                    type: "source",
                    source: "target",
                    sourceId: "target-1",
                    sourceField: "output",
                  },
                  expected_output: {
                    type: "source",
                    source: "dataset",
                    sourceId: "test-data",
                    sourceField: "expected_output",
                  },
                  // "input" is optional and not mapped - OK!
                },
              },
            },
          },
        ],
      });

      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // Wait for the table to render
      await waitFor(() => {
        expect(screen.getAllByText("LLM Answer Match").length).toBeGreaterThan(0);
      });

      // Alert icon should NOT be present (optional field missing is OK)
      const alertIcons = screen.queryAllByTestId("evaluator-missing-mapping-alert-evaluator-1");
      expect(alertIcons.length).toBe(0);
    });
  });

  describe("Edit Configuration", () => {
    it("opens evaluator editor drawer when Edit Configuration is clicked", async () => {
      const user = userEvent.setup();

      // Set up store with target and evaluator
      useEvaluationsV3Store.setState({
        targets: [createTestTarget()],
        datasets: [createTestDataset()],
        activeDatasetId: "test-data",
        evaluators: [createTestEvaluator()],
      });

      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // Wait for the evaluator chips to render (multiple, one per row)
      await waitFor(() => {
        expect(screen.getAllByText("Exact Match").length).toBeGreaterThan(0);
      });

      // Click on the first evaluator chip to open the menu
      const chips = screen.getAllByText("Exact Match");
      await user.click(chips[0]!);

      // Wait for menu to appear and click "Edit Configuration"
      await waitFor(() => {
        expect(screen.getByText("Edit Configuration")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Edit Configuration"));

      // Verify the drawer was opened with correct params
      expect(openedDrawerType).toBe("evaluatorEditor");
      expect(openedDrawerParams.evaluatorId).toBe("db-eval-1");
      // mappingsConfig should be provided (it's an object so it goes to params via complexProps)
      expect(openedDrawerParams.mappingsConfig).toBeDefined();
    });
  });

  describe("Run Evaluation validation", () => {
    it("opens evaluator drawer when Run Evaluation is clicked with missing evaluator mappings", async () => {
      const user = userEvent.setup();

      // Set up store with complete target mappings but incomplete evaluator mappings
      useEvaluationsV3Store.setState({
        targets: [
          createTestTarget({
            mappings: {
              "test-data": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "test-data",
                  sourceField: "input",
                },
              },
            },
          }),
        ],
        datasets: [createTestDataset()],
        activeDatasetId: "test-data",
        evaluators: [
          createTestEvaluator({
            // No mappings - will fail validation
            mappings: {},
          }),
        ],
      });

      // Render the Run Evaluation button directly
      render(<RunEvaluationButton />, { wrapper: Wrapper });

      // Wait for button to render
      await waitFor(() => {
        expect(screen.getByTestId("run-evaluation-button")).toBeInTheDocument();
      });

      // Click Run Evaluation
      await user.click(screen.getByTestId("run-evaluation-button"));

      // Verify evaluator editor drawer was opened
      expect(openedDrawerType).toBe("evaluatorEditor");
      expect(openedDrawerParams.evaluatorId).toBe("db-eval-1");
      // mappingsConfig should be provided (it's an object so it goes to params via complexProps)
      expect(openedDrawerParams.mappingsConfig).toBeDefined();
    });

    it("validates targets before evaluators", async () => {
      const user = userEvent.setup();

      // Set up store with incomplete target AND evaluator mappings
      // Add localPromptConfig with message using {{input}} so the field is considered "used"
      useEvaluationsV3Store.setState({
        targets: [
          createTestTarget({
            // No mappings - will fail validation first
            mappings: {},
            // Add localPromptConfig with a message that uses the "input" field
            localPromptConfig: {
              llm: { model: "openai/gpt-4", temperature: 0.7 },
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
              messages: [{ role: "user", content: "Hello {{input}}" }],
            },
          }),
        ],
        datasets: [createTestDataset()],
        activeDatasetId: "test-data",
        evaluators: [
          createTestEvaluator({
            mappings: {},
          }),
        ],
      });

      // Render the Run Evaluation button directly
      render(<RunEvaluationButton />, { wrapper: Wrapper });

      // Wait for button to render
      await waitFor(() => {
        expect(screen.getByTestId("run-evaluation-button")).toBeInTheDocument();
      });

      // Click Run Evaluation
      await user.click(screen.getByTestId("run-evaluation-button"));

      // Verify target (prompt) drawer was opened first, not evaluator
      // Since the target uses {{input}} but has no mapping for it, it should fail first
      expect(openedDrawerType).toBe("promptEditor");
    });
  });
});
