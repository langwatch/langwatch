/**
 * @vitest-environment jsdom
 *
 * Entry point drawer: the fields are user-owned workflow inputs, the dataset
 * is an optional attachment rendered as a compact card, and the drawer links
 * across to the End node. The variables editor is the real component (not a
 * stub) since the editable inputs ARE the behavior under test.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "@langwatch/workflow-contract";
import { VariablesSection } from "@langwatch/prompt-web/surfaces/variables";

const mockSetNode = vi.fn();
const mockSetSelectedNode = vi.fn();

vi.mock("../../../../behavior/use-workflow-store", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      setNode: mockSetNode,
      setSelectedNode: mockSetSelectedNode,
      nodes: [
        { id: "entry", type: "entry" },
        { id: "end", type: "end" },
      ],
    }),
}));

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

import { EntryPointPropertiesPanel } from "../workflow-entry-point-properties-panel";
import type { WorkflowVariablesProps } from "../workflow-properties.ports";

const createEntryNode = (overrides: Partial<Entry> = {}): Node<Entry> => ({
  id: "entry",
  type: "entry",
  position: { x: 0, y: 0 },
  data: {
    name: "Entry point",
    outputs: [{ identifier: "query", type: "str" }],
    entry_selection: "first",
    train_size: 0.8,
    test_size: 0.2,
    seed: 42,
    ...overrides,
  } as Entry,
});

const renderPanel = (node: Node<Entry> = createEntryNode(), datasetTotal: number | undefined = undefined) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <EntryPointPropertiesPanel
        node={node}
        renderBase={({ children }) => <div data-testid="base-properties-panel">{children}</div>}
        renderVariables={(props: WorkflowVariablesProps) => <VariablesSection {...props} />}
        renderDatasetModal={({ open }) => (open ? <div data-testid="dataset-modal" /> : null)}
        datasetTotal={datasetTotal}
        renderPropertySectionTitle={({ children }) => <span>{children}</span>}
      />
    </ChakraProvider>,
  );

describe("EntryPointPropertiesPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when the entry has no dataset", () => {
    /** @scenario A dataset is not required on the entry point */
    it("offers attaching a dataset and renders no dataset card", () => {
      renderPanel();

      expect(screen.getByTestId("attach-dataset-button")).toBeInTheDocument();
      expect(screen.queryByTestId("entry-dataset-card")).not.toBeInTheDocument();
    });

    /** @scenario Adding an input on the entry point */
    it("lets the user add an input field", async () => {
      renderPanel();
      const user = userEvent.setup();

      expect(screen.getByText("Inputs")).toBeInTheDocument();
      await user.click(screen.getByTestId("add-variable-button"));
      await user.click(screen.getByRole("menuitem", { name: /Text/ }));

      await waitFor(() => {
        const updates = mockSetNode.mock.calls.map(
          (c) => c[0] as { id: string; data: { outputs?: unknown[] } },
        );
        const update = updates.find((u) => u.data.outputs?.length === 2);
        expect(update).toBeTruthy();
      });
    });

    /** @scenario The entry point accepts an image input */
    it("lets the user add an image input", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.click(screen.getByTestId("add-variable-button"));
      await user.click(screen.getByRole("menuitem", { name: /Image/ }));

      await waitFor(() => {
        const updates = mockSetNode.mock.calls.map(
          (c) => c[0] as { id: string; data: { outputs?: { type: string }[] } },
        );
        const update = updates.find((u) => u.data.outputs?.some((o) => o.type === "image"));
        expect(update).toBeTruthy();
      });
    });

    /** @scenario An entry input can carry a default value */
    it("stores a default value typed for an input", async () => {
      renderPanel();

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });

      await waitFor(() => {
        const updates = mockSetNode.mock.calls.map(
          (c) => c[0] as { data: { outputs?: { identifier: string; value?: unknown }[] } },
        );
        const update = updates.find((u) =>
          u.data.outputs?.some((o) => o.identifier === "query" && o.value === "hello"),
        );
        expect(update).toBeTruthy();
      });
    });
  });

  describe("when a dataset is attached", () => {
    const datasetNode = () =>
      createEntryNode({
        dataset: { id: "dataset-1", name: "test-data" },
        outputs: [
          { identifier: "query", type: "str" },
          { identifier: "irrelevant", type: "str" },
        ],
      });

    it("shows the dataset as a compact card with name and row count", () => {
      renderPanel(datasetNode(), 20);

      const card = screen.getByTestId("entry-dataset-card");
      expect(card).toHaveTextContent("test-data");
      expect(card).toHaveTextContent("(20 rows)");
    });

    /** @scenario Removing a dataset-derived input keeps the dataset attached */
    it("removing an input does not touch the dataset", async () => {
      renderPanel(datasetNode(), 20);

      fireEvent.click(screen.getByTestId("remove-variable-irrelevant"));

      await waitFor(() => {
        const updates = mockSetNode.mock.calls.map(
          (c) => c[0] as { id: string; data: Record<string, unknown> },
        );
        const update = updates.find(
          (u) => Array.isArray(u.data.outputs) && u.data.outputs.length === 1,
        );
        expect(update).toBeTruthy();
        expect((update!.data.outputs as Array<{ identifier: string }>)[0]!.identifier).toBe(
          "query",
        );
        // setNode merges data shallowly - dataset is not part of the
        // update, so the attachment survives.
        expect("dataset" in update!.data).toBe(false);
      });
    });

    /** @scenario The entry panel offers no optimization split */
    /** @scenario The entry drawer offers no manual test entry picker */
    it("offers no optimization split configuration", () => {
      renderPanel(datasetNode(), 20);

      expect(screen.queryByText("Manual Test Entry")).not.toBeInTheDocument();
      expect(screen.queryByText("Optimization/Test Split")).not.toBeInTheDocument();
      expect(screen.queryByText(/train.*test split/i)).not.toBeInTheDocument();
    });
  });

  describe("when the workflow has an end node", () => {
    /** @scenario The entry drawer links to the End node */
    it("links to the End node drawer", () => {
      renderPanel();

      fireEvent.click(screen.getByTestId("go-to-end-node"));

      expect(mockSetSelectedNode).toHaveBeenCalledWith("end");
    });
  });
});
