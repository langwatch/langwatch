/**
 * @vitest-environment jsdom
 *
 * Evaluator End node: the results are a fixed four-field vocabulary
 * (passed, score, details, label) - normalized on open, read-only, with
 * a connect-score-or-passed nudge. Non-evaluator end nodes keep their
 * free-form results. The results render through the shared VariablesSection
 * (same row layout as every other node panel), with the value column hidden.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockSetNode = vi.fn();
let mockEdges: Array<{
  id: string;
  source: string;
  target: string;
  targetHandle?: string;
}> = [];
let mockWorkflowType = "workflow";

vi.mock(
  "~/optimization_studio/hooks/useWorkflowStore",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/optimization_studio/hooks/useWorkflowStore")
      >();
    return {
      ...actual,
      useWorkflowStore: (selector: (state: unknown) => unknown) =>
        selector({
          setNode: mockSetNode,
          nodes: [currentNode],
          edges: mockEdges,
          workflow_type: mockWorkflowType,
          getWorkflow: () => ({ nodes: [currentNode], edges: mockEdges }),
        }),
    };
  },
);

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

// Render the shell's children inline so the real VariablesSection mounts.
vi.mock("../BasePropertiesPanel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../BasePropertiesPanel")>();
  return {
    ...actual,
    BasePropertiesPanel: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="base-properties-panel">{children}</div>
    ),
  };
});

import type { End } from "../../../types/dsl";
import {
  EndPropertiesPanel,
  EVALUATOR_RESULT_FIELDS,
} from "../EndPropertiesPanel";

let currentNode: Node<End>;

const createEndNode = (overrides: Partial<End> = {}): Node<End> => ({
  id: "end",
  type: "end",
  position: { x: 0, y: 0 },
  data: {
    name: "End",
    inputs: [{ identifier: "output", type: "str" }],
    ...overrides,
  } as End,
});

const renderPanel = (node: Node<End>) => {
  currentNode = node;
  return render(
    <ChakraProvider value={defaultSystem}>
      <EndPropertiesPanel node={node} />
    </ChakraProvider>,
  );
};

describe("EndPropertiesPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockEdges = [];
    mockWorkflowType = "workflow";
  });

  describe("when the workflow behaves as an evaluator", () => {
    /** @scenario Evaluator End node lists exactly the four fixed result fields */
    it("normalizes the results to the fixed evaluator vocabulary", () => {
      renderPanel(
        createEndNode({
          behave_as: "evaluator",
          inputs: [{ identifier: "output", type: "str" }],
        }),
      );

      expect(mockSetNode).toHaveBeenCalledWith({
        id: "end",
        data: expect.objectContaining({ inputs: EVALUATOR_RESULT_FIELDS }),
      });
    });

    it("leaves the node alone when it already matches the contract", () => {
      renderPanel(
        createEndNode({
          behave_as: "evaluator",
          inputs: EVALUATOR_RESULT_FIELDS,
        }),
      );

      expect(mockSetNode).not.toHaveBeenCalled();
    });

    /** @scenario Evaluator End node results cannot be added or removed */
    it("renders the results read-only", () => {
      renderPanel(
        createEndNode({
          behave_as: "evaluator",
          inputs: EVALUATOR_RESULT_FIELDS,
        }),
      );

      expect(screen.getByText("Results")).toBeInTheDocument();
      // Read-only: the fixed vocabulary shows, but no add/remove affordances.
      expect(screen.getByTestId("variable-name-passed")).toBeInTheDocument();
      expect(screen.getByTestId("variable-name-score")).toBeInTheDocument();
      expect(
        screen.queryByTestId("add-variable-button"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("remove-variable-passed"),
      ).not.toBeInTheDocument();
    });

    it("nudges to connect score or passed when neither is wired", () => {
      mockEdges = [];
      renderPanel(
        createEndNode({
          behave_as: "evaluator",
          inputs: EVALUATOR_RESULT_FIELDS,
        }),
      );

      expect(screen.getByText(/Connect either a/i)).toBeInTheDocument();
    });

    /** @scenario Unconnected fixed fields are allowed */
    it("does not nudge when score is connected", () => {
      mockEdges = [
        {
          id: "e1",
          source: "judge",
          target: "end",
          targetHandle: "inputs.score",
        },
      ];
      renderPanel(
        createEndNode({
          behave_as: "evaluator",
          inputs: EVALUATOR_RESULT_FIELDS,
        }),
      );

      expect(screen.queryByText(/Connect either a/i)).not.toBeInTheDocument();
    });
  });

  describe("when the workflow type is evaluator but the end node lacks the flag", () => {
    /** @scenario Evaluator workflows normalize the end node even without the node flag */
    it("normalizes the hand-made fields to the fixed vocabulary and stamps the flag", () => {
      mockWorkflowType = "evaluator";
      renderPanel(
        createEndNode({
          inputs: [
            { identifier: "score", type: "float" },
            { identifier: "reasoning", type: "str" },
          ],
        }),
      );

      expect(mockSetNode).toHaveBeenCalledWith({
        id: "end",
        data: expect.objectContaining({
          behave_as: "evaluator",
          inputs: EVALUATOR_RESULT_FIELDS,
        }),
      });
    });

    /** @scenario Evaluator End node results cannot be added or removed */
    it("renders the results read-only from the workflow-level signal alone", () => {
      mockWorkflowType = "evaluator";
      renderPanel(
        createEndNode({
          behave_as: "evaluator",
          inputs: EVALUATOR_RESULT_FIELDS,
        }),
      );

      expect(screen.getByText("Results")).toBeInTheDocument();
      expect(
        screen.queryByTestId("add-variable-button"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the workflow is not an evaluator", () => {
    /** @scenario Non-evaluator workflows keep free-form end results */
    it("keeps the results editable and untouched", () => {
      renderPanel(createEndNode());

      expect(mockSetNode).not.toHaveBeenCalled();
      expect(screen.getByText("Results")).toBeInTheDocument();
      // Editable: the add affordance is present for free-form results.
      expect(screen.getByTestId("add-variable-button")).toBeInTheDocument();
    });
  });
});
