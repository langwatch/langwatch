/**
 * @vitest-environment jsdom
 *
 * Integration tests for the workflow dataset dialog: the shared
 * picker/editor experience on the entry-point node. Uses the real workflow
 * store; only the tRPC transport and drawer registry are mocked.
 * See specs/datasets/studio-choose-dataset.feature and
 * specs/studio/dataset-creation-regression.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { mockOpenDrawer, mockDatasets } = vi.hoisted(() => ({
  mockOpenDrawer: vi.fn(),
  mockDatasets: {
    current: [] as Array<{
      id: string;
      name: string;
      columnTypes: Array<{ name: string; type: string }>;
      updatedAt: Date;
      useS3: boolean;
      s3RecordCount: number | null;
      _count: { datasetRecords: number };
    }>,
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
  getComplexProps: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    organization: { id: "org-1" },
    hasPermission: () => true,
  }),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...original,
    useUpdateNodeInternals: () => vi.fn(),
  };
});

vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      getAll: {
        useQuery: () => ({
          data: mockDatasets.current,
          isLoading: false,
        }),
      },
      upsert: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      validateDatasetName: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
    datasetRecord: {
      getAll: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteMany: { useMutation: () => ({ mutate: vi.fn() }) },
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      download: {
        useMutation: () => ({ mutateAsync: vi.fn(), isLoading: false }),
      },
    },
    licenseEnforcement: {
      checkLimit: { useQuery: () => ({ data: null, isLoading: false }) },
    },
    useContext: () => ({}),
  },
}));

import { _useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Entry } from "../../types/dsl";
import { DatasetModal } from "../DatasetModal";

const ENTRY_NODE = {
  id: "entry",
  type: "entry",
  position: { x: 0, y: 0 },
  data: {
    name: "Entry point",
    entry_selection: "first",
    train_size: 0.8,
    test_size: 0.2,
    seed: 42,
    outputs: [],
  } as unknown as Entry,
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const getEntryNode = () =>
  _useWorkflowStore.getState().nodes.find((n) => n.id === "entry");

describe("Workflow dataset dialog", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    _useWorkflowStore.setState({
      nodes: [structuredClone(ENTRY_NODE)] as never,
      edges: [],
    });
    mockDatasets.current = [
      {
        id: "ds-1",
        name: "turn 10",
        columnTypes: [
          { name: "query", type: "string" },
          { name: "context", type: "string" },
        ],
        updatedAt: new Date("2026-06-01T10:00:00Z"),
        useS3: false,
        s3RecordCount: null,
        _count: { datasetRecords: 10 },
      },
    ];
  });

  describe("when choosing a dataset", () => {
    /** @scenario Choose opens the shared dataset picker */
    it("opens the shared picker with search and dataset facts", () => {
      render(<DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("dataset-picker-search")).toBeInTheDocument();
      expect(screen.getByTestId("dataset-card-turn 10")).toBeInTheDocument();
      expect(screen.getByText("10 entries")).toBeInTheDocument();
      expect(screen.getByText("2 columns")).toBeInTheDocument();
      expect(screen.getByText(/Updated/)).toBeInTheDocument();
    });

    /** @scenario Picking a dataset binds it to the node */
    it("attaches the picked dataset to the node and merges its columns into the outputs", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<DatasetModal open={true} onClose={onClose} node={ENTRY_NODE} />, {
        wrapper: Wrapper,
      });

      await user.click(screen.getByTestId("dataset-card-turn 10"));

      const entry = getEntryNode();
      expect((entry?.data as Entry).dataset).toEqual({
        id: "ds-1",
        name: "turn 10",
      });
      const outputIds = (entry?.data.outputs ?? []).map(
        (f: { identifier: string }) => f.identifier,
      );
      expect(outputIds).toContain("query");
      expect(outputIds).toContain("context");
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("when creating a new dataset", () => {
    /** @scenario New dataset button opens the dataset editor directly */
    it("drafts an inline dataset and opens the editor, no CSV upload required", async () => {
      const user = userEvent.setup();
      render(<DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} />, {
        wrapper: Wrapper,
      });

      await user.click(screen.getByTestId("new-draft-dataset"));

      // Editor view opens directly on the draft
      expect(
        await screen.findByTestId("dataset-editor-table"),
      ).toBeInTheDocument();
      expect(screen.getByText("Draft Dataset")).toBeInTheDocument();
      // No CSV upload gate anywhere in the path
      expect(screen.queryByText(/drop your csv/i)).not.toBeInTheDocument();
    });

    /** @scenario Creating a dataset sets it as the active dataset */
    it("attaches the draft to the node as its active dataset", async () => {
      const user = userEvent.setup();
      render(<DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} />, {
        wrapper: Wrapper,
      });

      await user.click(screen.getByTestId("new-draft-dataset"));

      const entry = getEntryNode();
      const dataset = (entry?.data as Entry).dataset;
      expect(dataset?.name).toBe("Draft Dataset");
      expect(dataset?.inline?.columnTypes.map((c) => c.name)).toEqual([
        "input",
        "expected_output",
      ]);
    });

    /** @scenario New dataset button works when a dataset already exists */
    it("drafts a new dataset even when the node already has one", async () => {
      _useWorkflowStore.setState({
        nodes: [
          {
            ...structuredClone(ENTRY_NODE),
            data: {
              ...structuredClone(ENTRY_NODE.data),
              dataset: { id: "ds-1", name: "turn 10" },
            },
          },
        ] as never,
      });
      const user = userEvent.setup();
      render(<DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} />, {
        wrapper: Wrapper,
      });

      await user.click(screen.getByTestId("new-draft-dataset"));

      expect(
        await screen.findByTestId("dataset-editor-table"),
      ).toBeInTheDocument();
      const entry = getEntryNode();
      expect((entry?.data as Entry).dataset?.name).toBe("Draft Dataset");
    });
  });

  describe("when editing a draft dataset", () => {
    /** @scenario Editing a draft dataset keeps it in the workflow */
    it("writes cell edits into the workflow DSL and offers saving as a real dataset", async () => {
      const draft: Entry["dataset"] = {
        name: "Draft Dataset",
        inline: {
          records: { input: ["hello"], expected_output: ["world"] },
          columnTypes: [
            { name: "input", type: "string" },
            { name: "expected_output", type: "string" },
          ],
        },
      };
      _useWorkflowStore.setState({
        nodes: [
          {
            ...structuredClone(ENTRY_NODE),
            data: { ...structuredClone(ENTRY_NODE.data), dataset: draft },
          },
        ] as never,
      });
      const user = userEvent.setup();
      render(
        <DatasetModal
          open={true}
          onClose={vi.fn()}
          node={ENTRY_NODE}
          editingDataset={draft}
        />,
        { wrapper: Wrapper },
      );

      // Edit a cell
      await user.dblClick(await screen.findByTestId("cell-0-input_0"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "bonjour{Enter}");

      // The change landed in the workflow DSL, not in any database
      await waitFor(() => {
        const entry = getEntryNode();
        expect((entry?.data as Entry).dataset?.inline?.records.input?.[0]).toBe(
          "bonjour",
        );
      });

      // Promotion to a real dataset is offered
      expect(screen.getByTestId("save-draft-as-dataset")).toBeInTheDocument();
      await user.click(screen.getByTestId("save-draft-as-dataset"));
      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "addOrEditDataset",
        expect.objectContaining({
          datasetToSave: expect.objectContaining({ name: "Draft Dataset" }),
        }),
      );
    });
  });
});
