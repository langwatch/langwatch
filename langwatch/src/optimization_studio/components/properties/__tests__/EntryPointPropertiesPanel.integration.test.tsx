/**
 * @vitest-environment jsdom
 *
 * Entry point drawer: the fields are user-owned workflow inputs, the
 * dataset is an optional attachment rendered as a compact card, and the
 * drawer links across to the End node.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: vi.fn(),
  }),
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "test-user" } },
    status: "authenticated",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
    organization: { id: "test-org" },
    team: null,
  }),
}));

const mockSetNode = vi.fn();
const mockSetSelectedNode = vi.fn();

vi.mock("../../../hooks/useWorkflowStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../hooks/useWorkflowStore")>();
  return {
    ...actual,
    useWorkflowStore: (selector: (state: unknown) => unknown) =>
      selector({
        setNode: mockSetNode,
        setSelectedNode: mockSetSelectedNode,
        nodes: [
          { id: "entry", type: "entry" },
          { id: "end", type: "end" },
        ],
        edges: [],
        getWorkflow: () => ({ nodes: [], edges: [] }),
      }),
  };
});

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

// The dataset picker/editor dialog is its own surface - not under test.
vi.mock("../../DatasetModal", () => ({
  DatasetModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dataset-modal" /> : null,
}));

const mockUseGetDatasetData = vi.fn();
vi.mock("../../../hooks/useGetDatasetData", () => ({
  useGetDatasetData: (args: unknown) => mockUseGetDatasetData(args),
}));

// Keep the shell light but the FieldsDefinition editor real - the
// editable inputs ARE the behavior under test.
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

import type { Entry } from "../../../types/dsl";
import { EntryPointPropertiesPanel } from "../EntryPointPropertiesPanel";

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

const renderPanel = (node: Node<Entry> = createEntryNode()) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <EntryPointPropertiesPanel node={node} />
    </ChakraProvider>,
  );

describe("EntryPointPropertiesPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when the entry has no dataset", () => {
    beforeEach(() => {
      mockUseGetDatasetData.mockReturnValue({
        rows: undefined,
        columns: [],
        total: undefined,
      });
    });

    /** @scenario A dataset is not required on the entry point */
    it("offers attaching a dataset and renders no data grid", () => {
      renderPanel();

      expect(screen.getByTestId("attach-dataset-button")).toBeInTheDocument();
      expect(
        screen.queryByTestId("entry-dataset-card"),
      ).not.toBeInTheDocument();
      // No split/manual-entry config without a dataset to split.
      expect(
        screen.queryByText("Optimization/Test Split"),
      ).not.toBeInTheDocument();
    });

    /** @scenario Adding an input on the entry point */
    it("lets the user add an input field", () => {
      renderPanel();

      expect(screen.getByText("Inputs")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("add-outputs-field-button"));

      // FieldsDefinition appends an empty editable field and submits the
      // node update on change.
      expect(mockSetNode).toHaveBeenCalledWith(
        expect.objectContaining({ id: "entry" }),
      );
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

    beforeEach(() => {
      mockUseGetDatasetData.mockReturnValue({
        rows: [],
        columns: [
          { name: "query", type: "string" },
          { name: "irrelevant", type: "string" },
        ],
        total: 20,
      });
    });

    it("shows the dataset as a compact card with name and row count", () => {
      renderPanel(datasetNode());

      const card = screen.getByTestId("entry-dataset-card");
      expect(card).toHaveTextContent("test-data");
      expect(card).toHaveTextContent("(20 rows)");
    });

    /** @scenario Removing a dataset-derived input keeps the dataset attached */
    it("removing an input does not touch the dataset", async () => {
      renderPanel(datasetNode());

      const removeButtons = screen.getAllByTestId("remove-outputs-field");
      fireEvent.click(removeButtons[1]!);

      // The remove submits through react-hook-form asynchronously; find
      // the node update that carries the shrunken field list.
      await waitFor(() => {
        const updates = mockSetNode.mock.calls.map(
          (c) => c[0] as { id: string; data: Record<string, unknown> },
        );
        const update = updates.find(
          (u) => Array.isArray(u.data.outputs) && u.data.outputs.length === 1,
        );
        expect(update).toBeTruthy();
        expect(
          (update!.data.outputs as Array<{ identifier: string }>)[0]!
            .identifier,
        ).toBe("query");
        // setNode merges data shallowly - dataset is not part of the
        // update, so the attachment survives.
        expect("dataset" in update!.data).toBe(false);
      });
    });

    it("detaching the dataset keeps the inputs", () => {
      renderPanel(datasetNode());

      fireEvent.click(screen.getByTestId("detach-dataset-button"));

      const call = mockSetNode.mock.calls.at(-1)![0] as {
        id: string;
        data: { dataset?: unknown; outputs: unknown[] };
      };
      expect(call.data.dataset).toBeUndefined();
      expect(call.data.outputs).toHaveLength(2);
    });

    it("shows the split and manual test entry sections", () => {
      renderPanel(datasetNode());

      expect(screen.getByText("Optimization/Test Split")).toBeInTheDocument();
      expect(screen.getByText("Manual Test Entry")).toBeInTheDocument();
    });
  });

  describe("when the workflow has an end node", () => {
    beforeEach(() => {
      mockUseGetDatasetData.mockReturnValue({
        rows: undefined,
        columns: [],
        total: undefined,
      });
    });

    /** @scenario The entry drawer links to the End node */
    it("links to the End node drawer", () => {
      renderPanel();

      fireEvent.click(screen.getByTestId("go-to-end-node"));

      expect(mockSetSelectedNode).toHaveBeenCalledWith("end");
    });
  });
});
