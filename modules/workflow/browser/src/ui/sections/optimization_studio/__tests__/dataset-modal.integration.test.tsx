import {
  uiDeclarations,
  type UiDatasetEditorTableProps,
  type UiDatasetPickerListProps,
} from "@langwatch/browser-host/declarations";
/**
 * @vitest-environment jsdom
 *
 * Workflow dataset dialog (picker/editor on entry-point node).
 * Uses real store; mocks tRPC transport and drawer registry.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOpenDrawer, mockDatasets } = vi.hoisted(() => ({
  mockOpenDrawer: vi.fn(),
  mockDatasets: {
    current: [] as {
      id: string;
      name: string;
      columnTypes: { name: string; type: string }[];
      updatedAt: Date;
      useS3: boolean;
      s3RecordCount: number | null;
      _count: { datasetRecords: number };
    }[],
  },
}));

/**
 * Dataset lends its editor and its picker list. The editor stand-in reports an edited first
 * cell the way the editor does; the picker stand-in hands back "turn 10" when it is picked.
 */
const datasetLends = uiDeclarations([
  {
    name: "dataset",
    installation: {
      capabilities: {
        datasetPickerList: {
          load: async () => ({
            default: ({ onSelect }: UiDatasetPickerListProps) => (
              <div data-testid="dataset-picker">
                <button
                  type="button"
                  data-testid="dataset-card-turn 10"
                  onClick={() =>
                    onSelect({
                      datasetId: "ds-1",
                      name: "turn 10",
                      columnTypes: [
                        { name: "query", type: "string" },
                        { name: "context", type: "string" },
                      ],
                    })
                  }
                >
                  turn 10
                </button>
              </div>
            ),
          }),
        },
        datasetEditorTable: {
          load: async () => ({
            default: ({
              title,
              headerActions,
              inMemoryDataset,
              onUpdateDataset,
            }: UiDatasetEditorTableProps) => (
              <div data-testid="dataset-editor-table">
                {title}
                {headerActions}
                <button
                  type="button"
                  aria-label="Edit the first cell"
                  data-testid="lent-editor-edit-first-cell"
                  onClick={() => {
                    if (!inMemoryDataset) return;
                    onUpdateDataset?.({
                      ...inMemoryDataset,
                      datasetRecords: inMemoryDataset.datasetRecords.map((record, index) =>
                        index === 0 ? { ...record, input: "bonjour" } : record,
                      ),
                    });
                  }}
                />
              </div>
            ),
          }),
        },
      },
    },
  },
]);

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => datasetLends,
}));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
  getComplexProps: () => ({}),
}));

vi.mock("../../../../behavior/studio-host/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    organization: { id: "org-1" },
    hasPermission: () => true,
  }),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof reactModule>();
  return {
    ...original,
    useUpdateNodeInternals: () => vi.fn(),
  };
});

vi.mock("../../../../behavior/workflow-api.ts", () => ({
  workflowApi: {
    licenseEnforcement: {
      checkLimit: { useQuery: () => ({ data: null, isLoading: false }) },
    },
    useUtils: () => ({}),
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({}),
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
      // The saved-dataset editor reads one page at a time now; draft (in-memory)
      // mode keeps it disabled but the hook is still invoked, so it must exist.
      listPaginated: {
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
  },
}));

import type { Entry } from "@langwatch/workflow-contract";
import type * as reactModule from "@xyflow/react";

import { _useWorkflowStore } from "../../../../behavior/use-workflow-store.ts";
import { DatasetModal } from "../dataset-modal.tsx";

const ENTRY_DATA: Entry = {
  name: "Entry point",
  entry_selection: "first",
  train_size: 0.8,
  test_size: 0.2,
  seed: 42,
  outputs: [],
};

const ENTRY_NODE = {
  id: "entry",
  type: "entry",
  position: { x: 0, y: 0 },
  data: ENTRY_DATA,
};

const getEntryNode = () => _useWorkflowStore.getState().nodes.find((n) => n.id === "entry");

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
    it("opens the picker dataset lends", async () => {
      renderWithDesignSystem(<DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} />);

      expect(await screen.findByTestId("dataset-picker")).toBeInTheDocument();
    });

    /** @scenario Picking a dataset binds it to the node */
    it("attaches the picked dataset to the node and merges its columns into the outputs", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderWithDesignSystem(<DatasetModal open={true} onClose={onClose} node={ENTRY_NODE} />);

      await user.click(await screen.findByTestId("dataset-card-turn 10"));

      const entry = getEntryNode();
      expect((entry?.data as Entry | undefined)?.dataset).toEqual({
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

  describe("when uploading a CSV", () => {
    it("opens dataset's upload drawer by name and binds what it creates", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderWithDesignSystem(<DatasetModal open={true} onClose={onClose} node={ENTRY_NODE} />);

      await user.click(screen.getByTestId("upload-csv-dataset"));

      expect(mockOpenDrawer).toHaveBeenCalledWith("uploadCSV", {
        enableDirectUpload: false,
        onSuccess: expect.any(Function),
      });
      const [, { onSuccess }] = mockOpenDrawer.mock.calls[0]!;
      await act(async () => {
        onSuccess({
          datasetId: "ds-2",
          name: "uploaded",
          columnTypes: [{ name: "question", type: "string" }],
        });
      });

      expect((getEntryNode()?.data as Entry | undefined)?.dataset).toEqual({
        id: "ds-2",
        name: "uploaded",
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("when creating a new dataset", () => {
    /** @scenario New dataset button opens the dataset editor directly */
    it("drafts an inline dataset and opens the editor, no CSV upload required", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} />);

      await user.click(screen.getByTestId("new-draft-dataset"));

      // Editor view opens directly on the draft
      expect(await screen.findByTestId("dataset-editor-table")).toBeInTheDocument();
      expect(screen.getByText("Draft Dataset")).toBeInTheDocument();
      // No CSV upload gate anywhere in the path
      expect(screen.queryByText(/drop your csv/i)).not.toBeInTheDocument();
    });

    /** @scenario Creating a dataset sets it as the active dataset */
    it("attaches the draft to the node as its active dataset", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} />);

      await user.click(screen.getByTestId("new-draft-dataset"));

      const entry = getEntryNode();
      const dataset = (entry?.data as Entry | undefined)?.dataset;
      expect(dataset?.name).toBe("Draft Dataset");
      expect(dataset?.inline?.columnTypes.map((c) => c.name)).toEqual(["input", "expected_output"]);
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
      renderWithDesignSystem(<DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} />);

      await user.click(screen.getByTestId("new-draft-dataset"));

      expect(await screen.findByTestId("dataset-editor-table")).toBeInTheDocument();
      const entry = getEntryNode();
      expect((entry?.data as Entry | undefined)?.dataset?.name).toBe("Draft Dataset");
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
      renderWithDesignSystem(
        <DatasetModal open={true} onClose={vi.fn()} node={ENTRY_NODE} editingDataset={draft} />,
      );

      // Dataset's lent editor reports an edited cell
      await user.click(await screen.findByTestId("lent-editor-edit-first-cell"));

      // The change landed in the workflow DSL, not in any database
      await waitFor(() => {
        const entry = getEntryNode();
        expect((entry?.data as Entry | undefined)?.dataset?.inline?.records.input?.[0]).toBe(
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
