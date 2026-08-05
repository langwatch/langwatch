/**
 * @vitest-environment jsdom
 *
 * Regression for the customer-reported infinite render loop: with a saved
 * dataset attached, useGetDatasetData returns a fresh `rows` array reference
 * on every render, so a prefill effect keyed on that reference re-fired every
 * render and never settled - "Maximum update depth exceeded" on plain studio
 * load (the dialog is mounted at the studio level even while closed). This
 * test renders the dialog open with that exact churn and asserts it settles
 * instead of crashing.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const entryNode = {
  id: "entry",
  type: "entry",
  data: {
    name: "Entry",
    outputs: [{ identifier: "question", type: "str" }],
    dataset: { id: "ds-1", name: "citation correctness eval" },
  },
};

vi.mock("~/optimization_studio/hooks/useRunUntilHereDialogStore", () => ({
  useRunUntilHereDialogStore: (selector: (s: unknown) => unknown) =>
    selector({ untilNodeId: "agent-1", close: vi.fn() }),
}));

vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({
      nodes: [entryNode],
      setNode: vi.fn(),
      deselectAllNodes: vi.fn(),
      setPropertiesExpanded: vi.fn(),
    }),
}));

vi.mock("~/optimization_studio/hooks/useWorkflowExecution", () => ({
  useWorkflowExecution: () => ({ startWorkflowExecution: vi.fn() }),
}));

// The crux: every call returns a NEW array reference with identical content,
// reproducing the saved-dataset churn that drove the loop.
vi.mock("~/optimization_studio/hooks/useGetDatasetData", () => ({
  useGetDatasetData: () => ({
    rows: [{ id: "r1", question: "What is LangWatch?" }],
    columns: [{ name: "question", type: "string" }],
    total: 1,
    query: { isFetching: false },
  }),
}));

vi.mock("~/components/datasets/editor/DatasetPreviewTable", () => ({
  DatasetPreviewTable: () => null,
}));

vi.mock("~/optimization_studio/components/nodes/Nodes", () => ({
  getNodeDisplayName: (node: { data?: { name?: string } }) =>
    node?.data?.name ?? "node",
}));

const { RunUntilHereDialog } = await import("../RunUntilHereDialog");

describe("given the run-until-here dialog with a saved dataset attached", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when the dialog is open and the dataset rows churn every render", () => {
    /** @scenario Opening run-until-here with a saved dataset does not loop */
    it("settles without exceeding the max render depth and prefills the first row", () => {
      // The pre-fix code threw "Maximum update depth exceeded" here.
      expect(() =>
        render(
          <ChakraProvider value={defaultSystem}>
            <RunUntilHereDialog />
          </ChakraProvider>,
        ),
      ).not.toThrow();

      expect(
        screen.getByDisplayValue("What is LangWatch?"),
      ).toBeInTheDocument();
    });
  });
});
