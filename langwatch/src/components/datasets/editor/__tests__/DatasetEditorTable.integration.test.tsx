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
      // The saved-dataset editor now reads one page at a time. Point it at the
      // same mock so saved-mode fixtures (which set the records via this fn)
      // drive the paged read; pages without `totalPages` read as a single page.
      listPaginated: {
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

// ── Whole-dataset total count ────────────────────────────────────────

describe("given the saved dataset's record count", () => {
  describe("when the dataset spans many pages", () => {
    it("shows the PG-authoritative whole-dataset total, not just the loaded page", async () => {
      getAllQuery.mockReturnValue({
        data: {
          id: "ds",
          name: "ds",
          columnTypes,
          count: 1640,
          totalPages: 33,
          page: 1,
          datasetRecords: [
            { id: "r1", entry: { input: "a", expected_output: "x" } },
            { id: "r2", entry: { input: "b", expected_output: "y" } },
          ],
        },
        isLoading: false,
        refetch: vi.fn(),
      });
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
          "1,640 records",
        ),
      );
      // Pagination replaced byte-cap truncation — no "X out of Y" partial notice.
      expect(screen.getByTestId("dataset-row-count")).not.toHaveTextContent(
        "out of",
      );
    });
  });

  describe("when the dataset is empty", () => {
    it("renders a single page, no pager, and never requests page 0", async () => {
      // total 0 -> server totalPages 0. The page must floor at 1: requesting
      // page 0 would fail the server's positive() guard and break the editor.
      const requested: Array<number | undefined> = [];
      const stable = {
        data: {
          id: "empty",
          name: "empty",
          columnTypes,
          count: 0,
          totalPages: 0,
          page: 1,
          datasetRecords: [],
        },
        isLoading: false,
        refetch: vi.fn(),
      };
      getAllQuery.mockReset();
      getAllQuery.mockImplementation((input: { page?: number }) => {
        requested.push(input?.page);
        return stable; // stable ref (like react-query) — avoids a reload loop
      });
      render(<DatasetEditorTable datasetId="empty" />, { wrapper: Wrapper });

      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
          "0 records",
        ),
      );
      expect(screen.queryByTestId("dataset-pager")).not.toBeInTheDocument();
      // An empty dataset is its own last page, so the add-row stays available.
      expect(screen.getByTestId("add-row")).toBeInTheDocument();
      expect(requested).not.toContain(0);
    });
  });
});

// ── Pagination (classic page N of M) ─────────────────────────────────

describe("given a saved dataset larger than one page", () => {
  const TOTAL_PAGES = 3;
  const COUNT = 150;

  // Return a STABLE object reference per page, the way react-query does — an
  // unstable ref every render would make the store-load effect re-run forever.
  const renderPaged = () => {
    const byPage = new Map<number, unknown>();
    getAllQuery.mockReset();
    getAllQuery.mockImplementation((input: { page?: number }) => {
      const p = input?.page ?? 1;
      if (!byPage.has(p)) {
        byPage.set(p, {
          data: {
            id: "dataset_paged",
            name: "paged",
            columnTypes,
            count: COUNT,
            totalPages: TOTAL_PAGES,
            page: p,
            truncated: false,
            datasetRecords: [
              {
                id: `p${p}r1`,
                entry: { input: `page${p}-a`, expected_output: "x" },
              },
              {
                id: `p${p}r2`,
                entry: { input: `page${p}-b`, expected_output: "y" },
              },
            ],
          },
          isLoading: false,
          refetch: vi.fn(),
        });
      }
      return byPage.get(p);
    });
    return render(<DatasetEditorTable datasetId="dataset_paged" />, {
      wrapper: Wrapper,
    });
  };

  /** @scenario A dataset larger than one page shows the first page with a pager */
  it("shows the first page, the pager, and the whole-dataset total", async () => {
    renderPaged();
    await waitFor(() =>
      expect(screen.getByTestId("dataset-page-indicator")).toHaveTextContent(
        "Page 1 of 3",
      ),
    );
    // Total reflects the whole dataset, not just the loaded page.
    expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
      "150 records",
    );
    expect(screen.getByTestId("dataset-page-prev")).toBeDisabled();
    expect(screen.getByTestId("dataset-page-next")).toBeEnabled();
    // The add-row affordance is not offered on an earlier, full page.
    expect(screen.queryByTestId("add-row")).not.toBeInTheDocument();
  });

  /** @scenario Move between pages */
  it("moves to the next page and back", async () => {
    const user = userEvent.setup();
    renderPaged();
    await screen.findByTestId("dataset-page-indicator");

    await user.click(screen.getByTestId("dataset-page-next"));
    await waitFor(() =>
      expect(screen.getByTestId("dataset-page-indicator")).toHaveTextContent(
        "Page 2 of 3",
      ),
    );
    // The editor requested page 2 from the server (windowed read, not a slice).
    expect(getAllQuery).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.anything(),
    );

    await user.click(screen.getByTestId("dataset-page-prev"));
    await waitFor(() =>
      expect(screen.getByTestId("dataset-page-indicator")).toHaveTextContent(
        "Page 1 of 3",
      ),
    );
  });

  /** @scenario Edits on a page are saved to the right record */
  it("saves an edit made on a later page to that page's own record", async () => {
    updateMutate.mockImplementation(
      (_args: unknown, opts?: { onSuccess?: () => void }) =>
        opts?.onSuccess?.(),
    );
    const user = userEvent.setup();
    renderPaged();
    await screen.findByTestId("dataset-page-indicator");

    // Move to page 2 first (no pending writes yet, so navigation is allowed),
    // then edit its first cell.
    await user.click(screen.getByTestId("dataset-page-next"));
    await screen.findByText("page2-a");
    await user.dblClick(screen.getByTestId("cell-0-input_0"));
    const textarea = await screen.findByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "edited{Enter}");

    // The save targets the page-2 record by its own id — pagination binds edits
    // per record, never by a positional slot within the page.
    await waitFor(
      () =>
        expect(updateMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            datasetId: "dataset_paged",
            recordId: "p2r1",
            updatedRecord: expect.objectContaining({ input: "edited" }),
          }),
          expect.anything(),
        ),
      { timeout: 2000 },
    );
  });

  /** @scenario A new row is added on the last page */
  it("offers the add-row only once on the last page", async () => {
    const user = userEvent.setup();
    renderPaged();
    await screen.findByTestId("dataset-page-indicator");
    expect(screen.queryByTestId("add-row")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("dataset-page-next")); // page 2
    await user.click(screen.getByTestId("dataset-page-next")); // page 3 (last)
    await waitFor(() =>
      expect(screen.getByTestId("dataset-page-indicator")).toHaveTextContent(
        "Page 3 of 3",
      ),
    );
    expect(screen.getByTestId("add-row")).toBeInTheDocument();
  });
});
