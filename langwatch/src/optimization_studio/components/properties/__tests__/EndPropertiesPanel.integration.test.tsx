/**
 * @vitest-environment jsdom
 *
 * Evaluator End node: the results are a fixed four-field vocabulary
 * (passed, score, details, label) — normalized on open, read-only, with
 * a connect-score-or-passed nudge. Non-evaluator end nodes keep their
 * free-form results.
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

vi.mock("~/optimization_studio/hooks/useWorkflowStore", async (
  importOriginal,
) => {
  const actual = await importOriginal<
    typeof import("~/optimization_studio/hooks/useWorkflowStore")
  >();
  return {
    ...actual,
    useWorkflowStore: (selector: (state: unknown) => unknown) =>
      selector({
        setNode: mockSetNode,
        nodes: [currentNode],
        edges: mockEdges,
        getWorkflow: () => ({ nodes: [currentNode], edges: mockEdges }),
      }),
  };
});

// Capture the props the panel hands to the shell — the read-only
// results contract is expressed through them.
const basePanelProps: Array<Record<string, unknown>> = [];
vi.mock("../BasePropertiesPanel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../BasePropertiesPanel")>();
  return {
    ...actual,
    BasePropertiesPanel: (props: Record<string, unknown>) => {
      basePanelProps.push(props);
      return (
        <div data-testid="base-properties-panel">
          {props.children as React.ReactNode}
        </div>
      );
    },
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
    basePanelProps.length = 0;
    mockEdges = [];
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

      expect(basePanelProps[0]).toMatchObject({
        inputsTitle: "Results",
        inputsReadOnly: true,
      });
    });

    it("nudges to connect score or passed when neither is wired", () => {
      mockEdges = [];
      renderPanel(
        createEndNode({
          behave_as: "evaluator",
          inputs: EVALUATOR_RESULT_FIELDS,
        }),
      );

      expect(
        screen.getByText(/Connect either a/i),
      ).toBeInTheDocument();
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

  describe("when the workflow is not an evaluator", () => {
    /** @scenario Non-evaluator workflows keep free-form end results */
    it("keeps the results editable and untouched", () => {
      renderPanel(createEndNode());

      expect(mockSetNode).not.toHaveBeenCalled();
      expect(basePanelProps[0]).toMatchObject({
        inputsTitle: "Results",
        inputsReadOnly: false,
      });
    });
  });
});
