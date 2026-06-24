/**
 * @vitest-environment jsdom
 *
 * Integration tests for the standalone DatasetEditorTable: the shared
 * TanStack dataset editor used by the /datasets pages, the workflow dataset
 * node, and prompt demonstrations. Renders the full component tree (table,
 * cells, portal editor); only the tRPC transport is mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetColumns } from "~/server/datasets/types";
import {
  DatasetEditorTable,
  type InMemoryDataset,
} from "../DatasetEditorTable";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app" },
    organization: { id: "org-1", name: "Acme" },
    team: { id: "team-1", name: "Platform" },
    hasPermission: () => true,
  }),
}));

const updateMutate = vi.fn();
const deleteManyMutate = vi.fn();
const getAllQuery = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    datasetRecord: {
      getAll: {
        useQuery: (...args: unknown[]) => getAllQuery(...args),
      },
      update: {
        useMutation: () => ({ mutate: updateMutate }),
      },
      deleteMany: {
        useMutation: () => ({ mutate: deleteManyMutate }),
      },
      create: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
      download: {
        useMutation: () => ({ mutateAsync: vi.fn(), isLoading: false }),
      },
    },
    dataset: {
      upsert: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      validateDatasetName: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
    licenseEnforcement: {
      checkLimit: { useQuery: () => ({ data: null, isLoading: false }) },
    },
    useContext: () => ({}),
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────

const columnTypes: DatasetColumns = [
  { name: "input", type: "string" },
  { name: "expected_output", type: "string" },
];

const makeInMemoryDataset = (): InMemoryDataset => ({
  name: "My Draft",
  columnTypes,
  datasetRecords: [
    { id: "r1", input: "hello", expected_output: "world" },
    { id: "r2", input: "ping", expected_output: "pong" },
  ],
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderInMemory = (
  overrides: Partial<Parameters<typeof DatasetEditorTable>[0]> = {},
) => {
  const onUpdateDataset = vi.fn();
  const utils = render(
    <DatasetEditorTable
      inMemoryDataset={makeInMemoryDataset()}
      onUpdateDataset={onUpdateDataset}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
  return { ...utils, onUpdateDataset };
};

beforeEach(() => {
  updateMutate.mockReset();
  deleteManyMutate.mockReset();
  getAllQuery.mockReset();
  getAllQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  });
});

afterEach(() => cleanup());

// ── Viewing ──────────────────────────────────────────────────────────

describe("given an in-memory dataset", () => {
  describe("when the editor renders", () => {
    /** @scenario Records render in a spreadsheet table */
    it("shows one row per record and one column per dataset column", () => {
      renderInMemory();

      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByText("expected_output")).toBeInTheDocument();
      expect(screen.getByText("hello")).toBeInTheDocument();
      expect(screen.getByText("world")).toBeInTheDocument();
      expect(screen.getByText("ping")).toBeInTheDocument();
      expect(screen.getByText("pong")).toBeInTheDocument();
      expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
        "2 records",
      );
    });
  });

  // ── Inline cell editing ────────────────────────────────────────────

  describe("when a cell is double-clicked", () => {
    /** @scenario Edit a cell inline */
    it("opens an editor over the cell and saves on Enter", async () => {
      const user = userEvent.setup();
      const { onUpdateDataset } = renderInMemory();

      const cell = screen.getByTestId("cell-0-input_0");
      await user.dblClick(cell);

      const textarea = await screen.findByRole("textbox");
      expect(textarea).toHaveValue("hello");

      await user.clear(textarea);
      await user.type(textarea, "bonjour{Enter}");

      await waitFor(() => {
        expect(screen.getByText("bonjour")).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(onUpdateDataset).toHaveBeenCalled();
      });
      const updated = onUpdateDataset.mock.calls.at(-1)?.[0];
      expect(updated.datasetRecords[0].input).toBe("bonjour");
    });

    /** @scenario Escape cancels a cell edit */
    it("keeps the original value when Escape is pressed", async () => {
      const user = userEvent.setup();
      const { onUpdateDataset } = renderInMemory();

      await user.dblClick(screen.getByTestId("cell-0-input_0"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "discarded");
      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      });
      expect(screen.getByText("hello")).toBeInTheDocument();
      expect(screen.queryByText("discarded")).not.toBeInTheDocument();
      expect(onUpdateDataset).not.toHaveBeenCalled();
    });
  });

  describe("when editing a boolean column", () => {
    /** @scenario Boolean cells validate input */
    it("rejects values that are not booleans and keeps the editor open", async () => {
      const user = userEvent.setup();
      const dataset: InMemoryDataset = {
        name: "Bools",
        columnTypes: [{ name: "passed", type: "boolean" }],
        datasetRecords: [{ id: "r1", passed: "true" }],
      };
      const { onUpdateDataset } = renderInMemory({
        inMemoryDataset: dataset,
      });

      await user.dblClick(screen.getByTestId("cell-0-passed_0"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "maybe{Enter}");

      expect(
        await screen.findByText(/Invalid value. Use: true, false, 1, or 0/i),
      ).toBeInTheDocument();
      // Editor stays open, nothing was saved
      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(onUpdateDataset).not.toHaveBeenCalled();
    });
  });

  describe("when editing a number column", () => {
    /** @scenario Number cells validate input */
    it("rejects values that are not numbers and keeps the editor open", async () => {
      const user = userEvent.setup();
      const dataset: InMemoryDataset = {
        name: "Numbers",
        columnTypes: [{ name: "score", type: "number" }],
        datasetRecords: [{ id: "r1", score: "1" }],
      };
      const { onUpdateDataset } = renderInMemory({
        inMemoryDataset: dataset,
      });

      await user.dblClick(screen.getByTestId("cell-0-score_0"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "abc{Enter}");

      expect(await screen.findByText(/Invalid number/i)).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(onUpdateDataset).not.toHaveBeenCalled();
    });
  });

  // ── Rows ───────────────────────────────────────────────────────────

  describe("when Add row is clicked", () => {
    /** @scenario Add a new row */
    it("appends an empty row without forcing it into edit mode", async () => {
      const user = userEvent.setup();
      renderInMemory();

      await user.click(screen.getByTestId("add-row"));

      await waitFor(() => {
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
          "3 records",
        );
      });
      // Add row must not steal focus or pop the cell editor open
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("when rows are selected and deleted", () => {
    /** @scenario Select and delete rows */
    it("removes the rows and propagates the change", async () => {
      const user = userEvent.setup();
      const { onUpdateDataset } = renderInMemory();

      await user.click(screen.getByLabelText("Select row 1"));
      await user.click(screen.getByLabelText("Select row 2"));

      const deleteButton = await screen.findByTestId("delete-selected-rows");
      expect(deleteButton).toHaveTextContent("Delete 2 rows");
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
          "0 records",
        );
      });
      expect(screen.queryByText("hello")).not.toBeInTheDocument();
      const updated = onUpdateDataset.mock.calls.at(-1)?.[0];
      expect(updated.datasetRecords).toHaveLength(0);
    });
  });
});

// ── Autosave (saved mode) ────────────────────────────────────────────

describe("given a saved dataset", () => {
  const savedDataset = {
    id: "ds-1",
    name: "Saved DS",
    columnTypes,
    datasetRecords: [
      { id: "rec-1", entry: { input: "hello", expected_output: "world" } },
    ],
  };

  beforeEach(() => {
    getAllQuery.mockReturnValue({
      data: savedDataset,
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  describe("when a cell edit is saved", () => {
    /** @scenario Cell edits autosave to the dataset */
    it("syncs the full record to the database and confirms in the status chip", async () => {
      updateMutate.mockImplementation(
        (_args: unknown, opts: { onSuccess: () => void }) => {
          opts.onSuccess();
        },
      );
      const user = userEvent.setup();
      render(<DatasetEditorTable datasetId="ds-1" />, { wrapper: Wrapper });

      await screen.findByText("hello");
      await user.dblClick(screen.getByTestId("cell-0-input_0"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "bonjour{Enter}");

      // Debounced sync fires the update with the FULL record
      await waitFor(
        () => {
          expect(updateMutate).toHaveBeenCalledWith(
            expect.objectContaining({
              projectId: "proj-1",
              datasetId: "ds-1",
              recordId: "rec-1",
              updatedRecord: expect.objectContaining({
                input: "bonjour",
                expected_output: "world",
              }),
            }),
            expect.anything(),
          );
        },
        { timeout: 2000 },
      );
      expect(
        await screen.findByTestId("save-status-saved"),
      ).toBeInTheDocument();
    });
  });

  describe("when saving to the server fails", () => {
    /** @scenario A failed save is visible, never silent */
    it("shows a failed-to-save state instead of pretending success", async () => {
      updateMutate.mockImplementation(
        (
          _args: unknown,
          opts: { onError: (e: { message: string }) => void },
        ) => {
          opts.onError({ message: "Plan limit reached" });
        },
      );
      const user = userEvent.setup();
      render(<DatasetEditorTable datasetId="ds-1" />, { wrapper: Wrapper });

      await screen.findByText("hello");
      await user.dblClick(screen.getByTestId("cell-0-input_0"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "bonjour{Enter}");

      expect(
        await screen.findByTestId("save-status-error", undefined, {
          timeout: 2000,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Failed to save/i)).toBeInTheDocument();
      // The edit is still visible locally, not silently discarded
      expect(screen.getByText("bonjour")).toBeInTheDocument();
    });
  });

  describe("when rows are deleted", () => {
    it("syncs the deletion to the database", async () => {
      deleteManyMutate.mockImplementation(
        (_args: unknown, opts: { onSuccess: () => void }) => {
          opts.onSuccess();
        },
      );
      const user = userEvent.setup();
      render(<DatasetEditorTable datasetId="ds-1" />, { wrapper: Wrapper });

      await screen.findByText("hello");
      await user.click(screen.getByLabelText("Select row 1"));
      await user.click(await screen.findByTestId("delete-selected-rows"));

      await waitFor(
        () => {
          expect(deleteManyMutate).toHaveBeenCalledWith(
            expect.objectContaining({
              projectId: "proj-1",
              datasetId: "ds-1",
              recordIds: ["rec-1"],
            }),
            expect.anything(),
          );
        },
        { timeout: 2000 },
      );
    });
  });
});

// ── Large-dataset read truncation (ADR-032) ──────────────────────────

describe("given a large saved dataset whose read is truncated", () => {
  const renderSaved = (data: Record<string, unknown>) => {
    getAllQuery.mockReturnValue({ data, isLoading: false, refetch: vi.fn() });
    return render(<DatasetEditorTable datasetId="dataset_big" />, {
      wrapper: Wrapper,
    });
  };

  describe("when the read is truncated", () => {
    it("shows the true total with a truncation notice, not just the loaded rows", async () => {
      renderSaved({
        id: "dataset_big",
        name: "dataset-images-2gb",
        columnTypes,
        count: 1640,
        truncated: true,
        datasetRecords: [
          { id: "r1", input: "a", expected_output: "x" },
          { id: "r2", input: "b", expected_output: "y" },
          { id: "r3", input: "c", expected_output: "z" },
        ],
      });

      // The count reflects the PG-authoritative total (1,640), NOT the 3 loaded
      // rows — and flags that the view is partial.
      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
          "3 out of 1,640 records",
        ),
      );
      // The explanation is keyboard/SR-reachable: the chip is focusable and
      // exposes the full tooltip copy via aria-label (not hover-only).
      const chip = screen.getByTestId("dataset-row-count");
      expect(chip).toHaveAttribute("tabindex", "0");
      expect(chip).toHaveAttribute(
        "aria-label",
        expect.stringContaining("too large to display in full"),
      );
    });
  });

  describe("when the read is not truncated", () => {
    it("shows the plain total with no truncation notice", async () => {
      renderSaved({
        id: "dataset_small",
        name: "small",
        columnTypes,
        count: 2,
        truncated: false,
        datasetRecords: [
          { id: "r1", input: "a", expected_output: "x" },
          { id: "r2", input: "b", expected_output: "y" },
        ],
      });

      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
          "2 records",
        ),
      );
      expect(screen.getByTestId("dataset-row-count")).not.toHaveTextContent(
        "out of",
      );
    });
  });
});
