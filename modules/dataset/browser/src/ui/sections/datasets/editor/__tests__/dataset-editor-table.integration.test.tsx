import type { DatasetColumns, InMemoryDataset } from "@langwatch/dataset-contract";
/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { DatasetEditorTable } from "../dataset-editor-table.tsx";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app" },
    organization: { id: "org-1", name: "Acme" },
    team: { id: "team-1", name: "Platform" },
  }),
}));

const updateMutate = vi.fn();
const deleteManyMutate = vi.fn();
const getAllQuery = vi.fn();

vi.mock("../../../../../behavior/dataset-api.ts", () => ({
  datasetApi: {
    licenseEnforcement: {
      checkLimit: { useQuery: () => ({ data: null, isLoading: false }) },
    },
    useUtils: () => ({}),
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({}),
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

const renderInMemory = (overrides: Partial<Parameters<typeof DatasetEditorTable>[0]> = {}) => {
  const onUpdateDataset = vi.fn();
  const utils = renderWithDesignSystem(
    <DatasetEditorTable
      inMemoryDataset={makeInMemoryDataset()}
      onUpdateDataset={onUpdateDataset}
      {...overrides}
    />,
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
      expect(screen.getByTestId("dataset-row-count")).toHaveTextContent("2 records");
    });
  });

  describe("when the dataset has thirty columns", () => {
    const thirtyColumns: DatasetColumns = Array.from({ length: 30 }, (_, i) => ({
      name: `column_${i}`,
      type: "string",
    }));
    const renderWide = () =>
      renderInMemory({
        inMemoryDataset: {
          name: "Wide",
          columnTypes: thirtyColumns,
          datasetRecords: [{ id: "r1", column_0: "hello" }],
        },
      });

    /** @scenario A dataset with many columns scrolls sideways instead of squeezing them */
    it("floors the grid at a minimum width per column so it scrolls sideways", () => {
      renderWide();

      const grid = screen.getByTestId("dataset-editor-grid");
      const columns = grid.querySelectorAll("colgroup col");
      expect(columns).toHaveLength(31);
      const checkboxColumnPx = 36;
      const floor = Number.parseInt(grid.style.minWidth, 10);
      expect(floor).toBeGreaterThanOrEqual(checkboxColumnPx + 30 * 160);
      expect(getComputedStyle(grid.parentElement!).overflowX).toBe("auto");
    });

    /** @scenario Moving with the keyboard to a column off screen scrolls it into view */
    it("scrolls each cell the keyboard selects into view", async () => {
      const scrollIntoView = vi
        .spyOn(Element.prototype, "scrollIntoView")
        .mockImplementation(() => {});
      try {
        const user = userEvent.setup();
        renderWide();

        await user.click(screen.getByText("hello"));
        for (let i = 0; i < 29; i++) await user.keyboard("{Tab}");

        const lastColumnIndex = 30;
        const row = screen.getByText("hello").closest("tr")!;
        const lastCell = row.querySelectorAll("td")[lastColumnIndex];
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(lastCell);
      } finally {
        scrollIntoView.mockRestore();
      }
    });
  });

  describe("when the dataset has more rows than the grid renders at once", () => {
    const rowCount = 150;
    const rowHeight = 160;
    const viewport = 800;
    let scrollTo: MockInstance<Element["scrollTo"]>;
    let layout: { mockRestore: () => void }[] = [];
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(async () => {
      scrollTo = vi.spyOn(Element.prototype, "scrollTo").mockImplementation(() => {});
      // jsdom lays nothing out; give the grid a viewport and a scroll height.
      layout = [
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(viewport),
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000),
        vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(viewport),
        vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(rowCount * rowHeight),
      ];
      user = userEvent.setup();
      renderInMemory({
        inMemoryDataset: {
          name: "Long",
          columnTypes,
          datasetRecords: Array.from({ length: rowCount }, (_, i) => ({
            id: `r${i}`,
            input: `value ${i}`,
            expected_output: "",
          })),
        },
      });
      await user.click(await screen.findByText("value 0"));
    });
    afterEach(() => {
      scrollTo.mockRestore();
      for (const spy of layout) spy.mockRestore();
    });

    const gridScroller = () => screen.getByTestId("dataset-editor-grid").parentElement!;

    /** @scenario Moving with the keyboard to a row that is not rendered brings it into view */
    it("scrolls the grid to the selected row once it leaves the rendered rows", async () => {
      scrollTo.mockClear();
      const selectedRow = 40;
      for (let i = 0; i < selectedRow; i++) await user.keyboard("{ArrowDown}");

      expect(scrollTo.mock.contexts.at(-1)).toBe(gridScroller());
      // Row 40's bottom edge lands on the viewport's bottom edge.
      const rowBottom = (selectedRow + 1) * rowHeight;
      expect(scrollTo.mock.calls.at(-1)?.[0]).toMatchObject({ top: rowBottom - viewport });
    });

    /** @scenario Moving to another column on a row scrolled out of view brings the row back */
    it("brings the selected row back when only the column changes after scrolling it away", async () => {
      const grid = gridScroller();
      scrollTo.mockClear();
      grid.scrollTop = 40 * rowHeight;
      fireEvent.scroll(grid);
      await waitFor(() => expect(screen.queryByText("value 0")).not.toBeInTheDocument());
      // Scrolling by hand leaves the selection where it is; only a keyboard move recovers it.
      expect(scrollTo).not.toHaveBeenCalled();

      await user.keyboard("{ArrowRight}");

      expect(scrollTo.mock.contexts.at(-1)).toBe(grid);
      expect(scrollTo.mock.calls.at(-1)?.[0]).toMatchObject({ top: 0 });
    });
  });

  describe("when the dataset has two columns", () => {
    /** @scenario A dataset with few columns still fills the grid */
    it("keeps the grid at the card's full width with a floor below it", () => {
      renderInMemory();

      const grid = screen.getByTestId("dataset-editor-grid");
      expect(getComputedStyle(grid).width).toBe("100%");
      expect(Number.parseInt(grid.style.minWidth, 10)).toBeLessThan(600);
    });
  });

  describe("when a column name is too long for its header", () => {
    /** @scenario A column name too long for its header is cut short, not overlapped */
    it("truncates the name on one line and offers the full name on hover", () => {
      const longName = "gold_skill_reason_for_the_thread_analysis";
      renderInMemory({
        inMemoryDataset: {
          name: "Long",
          columnTypes: [{ name: longName, type: "string" }],
          datasetRecords: [{ id: "r1", [longName]: "x" }],
        },
      });

      const label = screen.getByText(longName);
      expect(label.closest("th")).toHaveAttribute("title", longName);
      expect(getComputedStyle(label).textOverflow).toBe("ellipsis");
      expect(getComputedStyle(label).whiteSpace).toBe("nowrap");
      // A flex child only shrinks below its text with min-width 0, at every level.
      expect(getComputedStyle(label).minWidth).toBe("0px");
      expect(getComputedStyle(label.parentElement!).minWidth).toBe("0px");
    });
  });

  describe("when the page hands the editor a header slot", () => {
    it("puts the count and buttons in the slot and keeps the grid outside it", () => {
      const slot = document.createElement("div");
      document.body.appendChild(slot);

      renderInMemory({ headerSlot: slot });

      expect(slot).toContainElement(screen.getByTestId("dataset-row-count"));
      expect(slot).toContainElement(screen.getByTestId("download-csv"));
      expect(slot).not.toContainElement(screen.getByTestId("dataset-editor-table"));
      slot.remove();
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
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent("3 records");
      });
      // Add row must not steal focus or pop the cell editor open
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("when the selection is cleared from the bar", () => {
    it("empties the selection and returns focus to the select-all box", async () => {
      const user = userEvent.setup();
      renderInMemory();

      await user.click(screen.getByLabelText("Select row 1"));
      await user.click(await screen.findByRole("button", { name: "Clear selection" }));

      expect(screen.queryByTestId("dataset-selection-bar")).not.toBeInTheDocument();
      await waitFor(() => expect(document.querySelector("[data-select-all]")).toHaveFocus());
    });
  });

  describe("when rows are selected and deleted", () => {
    /** @scenario Select and delete rows */
    it("removes the rows and propagates the change", async () => {
      const user = userEvent.setup();
      const { onUpdateDataset } = renderInMemory();

      await user.click(screen.getByLabelText("Select row 1"));
      await user.click(screen.getByLabelText("Select row 2"));

      const bar = await screen.findByTestId("dataset-selection-bar");
      expect(bar).toHaveAttribute("data-placement", "inline");
      expect(bar).toHaveTextContent("2 selected");
      const deleteButton = screen.getByTestId("delete-selected-rows");
      expect(deleteButton).toHaveTextContent("Delete");
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent("0 records");
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
    datasetRecords: [{ id: "rec-1", entry: { input: "hello", expected_output: "world" } }],
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
      updateMutate.mockImplementation((_args: unknown, opts: { onSuccess: () => void }) => {
        opts.onSuccess();
      });
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetEditorTable datasetId="ds-1" />);

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
      expect(await screen.findByTestId("save-status-saved")).toBeInTheDocument();
    });
  });

  describe("when saving to the server fails", () => {
    /** @scenario A failed save is visible, never silent */
    it("shows a failed-to-save state instead of pretending success", async () => {
      updateMutate.mockImplementation(
        (_args: unknown, opts: { onError: (e: { message: string }) => void }) => {
          opts.onError({ message: "Plan limit reached" });
        },
      );
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetEditorTable datasetId="ds-1" />);

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
      deleteManyMutate.mockImplementation((_args: unknown, opts: { onSuccess: () => void }) => {
        opts.onSuccess();
      });
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetEditorTable datasetId="ds-1" />);

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

describe("given a saved dataset with two rows and a third typed into the trailing row", () => {
  beforeEach(() => {
    getAllQuery.mockReturnValue({
      data: {
        id: "ds-2",
        name: "Saved DS",
        columnTypes,
        datasetRecords: [
          { id: "rec-1", entry: { input: "What is LangWatch?", expected_output: "" } },
          { id: "rec-2", entry: { input: "How do I add a key?", expected_output: "" } },
        ],
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    updateMutate.mockImplementation((_args: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });
    deleteManyMutate.mockImplementation((_args: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });
  });

  describe("when only the third row is ticked and deleted", () => {
    /** @scenario Bulk delete removes exactly the ticked rows */
    it("sends the third row's own id and never the second row's", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetEditorTable datasetId="ds-2" />);

      await screen.findByText("How do I add a key?");
      await user.click(screen.getByTestId("add-row"));
      await user.dblClick(screen.getByTestId("cell-2-input_0"));
      await user.type(await screen.findByRole("textbox"), "t51 added question{Enter}");
      await waitFor(() => expect(updateMutate).toHaveBeenCalled(), { timeout: 2000 });
      const [createdUpdate] = updateMutate.mock.calls.at(-1) ?? [];
      const createdId = (createdUpdate as { recordId: string }).recordId;

      await user.click(screen.getByLabelText("Select row 3"));
      await user.click(await screen.findByTestId("delete-selected-rows"));

      await waitFor(() => expect(deleteManyMutate).toHaveBeenCalled(), { timeout: 2000 });
      const sent = deleteManyMutate.mock.calls.flatMap(
        ([args]) => (args as { recordIds: string[] }).recordIds,
      );
      expect(sent).toEqual([createdId]);
      expect(screen.getByText("How do I add a key?")).toBeInTheDocument();
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
      renderWithDesignSystem(<DatasetEditorTable datasetId="ds" />);

      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent("1,640 records"),
      );
      // Pagination replaced byte-cap truncation — no "X out of Y" partial notice.
      expect(screen.getByTestId("dataset-row-count")).not.toHaveTextContent("out of");
    });
  });

  describe("when the dataset is empty", () => {
    it("renders a single page, no pager, and never requests page 0", async () => {
      // total 0 -> server totalPages 0. The page must floor at 1: requesting
      // page 0 would fail the server's positive() guard and break the editor.
      const requested: (number | undefined)[] = [];
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
      renderWithDesignSystem(<DatasetEditorTable datasetId="empty" />);

      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent("0 records"),
      );
      expect(screen.queryByTestId("pagination")).not.toBeInTheDocument();
      // An empty dataset is its own last page, so the add-row stays available.
      expect(screen.getByTestId("add-row")).toBeInTheDocument();
      expect(requested).not.toContain(0);
    });
  });
});

// ── Pagination ───────────────────────────────────────────────────────

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
    return renderWithDesignSystem(<DatasetEditorTable datasetId="dataset_paged" />);
  };

  /** @scenario A dataset larger than one page shows the first page with a pager */
  it("shows the first page, the pager, and the whole-dataset total", async () => {
    renderPaged();
    await waitFor(() =>
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("showing 1–50"),
    );
    // Total reflects the whole dataset, not just the loaded page.
    expect(screen.getByTestId("dataset-row-count")).toHaveTextContent("150 records");
    expect(screen.getByTestId("pagination-prev")).toBeDisabled();
    expect(screen.getByTestId("pagination-next")).toBeEnabled();
    // The add-row affordance is not offered on an earlier, full page.
    expect(screen.queryByTestId("add-row")).not.toBeInTheDocument();
  });

  /** @scenario Move between pages */
  it("moves to the next page and back", async () => {
    const user = userEvent.setup();
    renderPaged();
    await screen.findByTestId("pagination-indicator");

    await user.click(screen.getByTestId("pagination-next"));
    await waitFor(() =>
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("showing 51–100"),
    );
    // The editor requested page 2 from the server (windowed read, not a slice).
    expect(getAllQuery).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.anything(),
    );

    await user.click(screen.getByTestId("pagination-prev"));
    await waitFor(() =>
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("showing 1–50"),
    );
  });

  describe("when the next page is still loading", () => {
    /** @scenario Move between pages */
    it("stays on the requested page instead of bouncing back to page 1", async () => {
      // react-query holds the previous page's result while the next page's key loads
      // (keepPreviousData), flagging it `isPlaceholderData: true`. Simulate that faithfully:
      // page 2 is not yet "ready", so the hook returns page 1's data marked as held — the page
      // count must NOT momentarily reset and snap navigation back to page 1, and the held data
      // must not re-hydrate the store (the guard skips it).
      const ready = new Set([1]);
      const fresh = new Map<number, unknown>();
      const held = new Map<number, unknown>();
      let lastReady = 1;
      const pageResult = (p: number, isPlaceholderData: boolean) => ({
        data: {
          id: "dataset_paged",
          name: "paged",
          columnTypes,
          count: 150,
          totalPages: 3,
          page: p,
          datasetRecords: [
            {
              id: `p${p}r1`,
              entry: { input: `page${p}-a`, expected_output: "x" },
            },
          ],
        },
        isLoading: false,
        isPlaceholderData,
        refetch: vi.fn(),
      });
      getAllQuery.mockReset();
      getAllQuery.mockImplementation((input: { page?: number }) => {
        const p = input?.page ?? 1;
        if (ready.has(p)) {
          lastReady = p;
          if (!fresh.has(p)) fresh.set(p, pageResult(p, false));
          return fresh.get(p);
        }
        // Previous page held while page p loads → flagged isPlaceholderData.
        if (!held.has(lastReady)) held.set(lastReady, pageResult(lastReady, true));
        return held.get(lastReady);
      });

      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetEditorTable datasetId="dataset_paged" />);
      await waitFor(() =>
        expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("showing 1–50"),
      );

      await user.click(screen.getByTestId("pagination-next"));
      // Page 2 is still loading — the indicator must show page 2, not bounce to 1,
      // and the last request must be for page 2.
      await waitFor(() =>
        expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("showing 51–100"),
      );
      expect((getAllQuery.mock.calls.at(-1)![0] as { page?: number }).page).toBe(2);
    });
  });

  /** @scenario Edits on a page are saved to the right record */
  it("saves an edit made on a later page to that page's own record", async () => {
    updateMutate.mockImplementation((_args: unknown, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
    );
    const user = userEvent.setup();
    renderPaged();
    await screen.findByTestId("pagination-indicator");

    // Move to page 2 first (no pending writes yet, so navigation is allowed),
    // then edit its first cell.
    await user.click(screen.getByTestId("pagination-next"));
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
    await screen.findByTestId("pagination-indicator");
    expect(screen.queryByTestId("add-row")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("pagination-next")); // page 2
    await user.click(screen.getByTestId("pagination-next")); // page 3 (last)
    await waitFor(() =>
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("showing 101–150"),
    );
    expect(screen.getByTestId("add-row")).toBeInTheDocument();
  });

  /** @scenario Change how many rows are shown per page */
  it("re-reads with the new limit and resets to page 1 when rows-per-page changes", async () => {
    const user = userEvent.setup();
    renderPaged();
    await screen.findByTestId("pagination-indicator");

    // The select reports the size currently in force.
    expect(screen.getByTestId("pagination-page-size")).toHaveValue("50");

    // Move off page 1 first so the reset-to-page-1 is observable.
    await user.click(screen.getByTestId("pagination-next"));
    await waitFor(() =>
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("showing 51–100"),
    );

    // Switch to 100 rows per page. The page count is derived from
    // count / pageSize, so 150 records collapse to 2 pages immediately, and the
    // server is re-read with the new limit from page 1.
    fireEvent.change(screen.getByTestId("pagination-page-size"), {
      target: { value: "100" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("showing 1–100"),
    );
    const lastCall = getAllQuery.mock.calls.at(-1)![0] as {
      page?: number;
      limit?: number;
    };
    expect(lastCall.limit).toBe(100);
    expect(lastCall.page).toBe(1);
  });
});

// keepPreviousData (held for the pagination no-bounce) must NOT bleed one
// dataset's rows into another when the editor is pointed at a different
// datasetId while the previous result is still being served.
describe("given the editor is switched to a different dataset", () => {
  const datasetAResult = (isPlaceholderData: boolean) => ({
    data: {
      id: "dataset_a",
      name: "A",
      columnTypes,
      count: 1,
      totalPages: 1,
      page: 1,
      datasetRecords: [{ id: "a1", entry: { input: "alpha", expected_output: "x" } }],
    },
    isLoading: false,
    // react-query sets this while keepPreviousData serves the prior key's data.
    isPlaceholderData,
    refetch: vi.fn(),
  });

  describe("when the previous dataset's data is still being served", () => {
    // Regression: robustness of the keepPreviousData hold across a datasetId
    // switch — not a feature scenario, so deliberately not @scenario-bound.
    it("never hydrates the new dataset id with the previous dataset's rows", async () => {
      updateMutate.mockImplementation((_args: unknown, opts?: { onSuccess?: () => void }) =>
        opts?.onSuccess?.(),
      );
      getAllQuery.mockReset();
      getAllQuery.mockReturnValue(datasetAResult(false));

      const user = userEvent.setup();
      const { rerender } = renderWithDesignSystem(<DatasetEditorTable datasetId="dataset_a" />);
      await screen.findByText("alpha");

      // Point the editor at dataset B; keepPreviousData still serves A's rows
      // (isPlaceholderData), so the grid keeps showing them until B settles.
      getAllQuery.mockReturnValue(datasetAResult(true));
      rerender(<DatasetEditorTable datasetId="dataset_b" />);

      // Edit the held cell before B's own data arrives.
      await user.dblClick(screen.getByTestId("cell-0-input_0"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "edited{Enter}");

      await waitFor(() => expect(updateMutate).toHaveBeenCalled(), {
        timeout: 2000,
      });
      // The write targets the dataset the rows actually belong to (A), never the
      // newly-selected B — without the guard the store would be hydrated as
      // B-id-with-A-rows and corrupt dataset B.
      expect(updateMutate).not.toHaveBeenCalledWith(
        expect.objectContaining({ datasetId: "dataset_b" }),
        expect.anything(),
      );
    });
  });
});

// Deleting rows shrinks the dataset, but only the current page lives in the
// store, so the server total must be re-read — otherwise the pager keeps the
// stale page count and can strand the user on a now-empty last page.
describe("given rows are deleted from a paginated dataset", () => {
  describe("when the deletion is saved", () => {
    // Regression: post-delete count refresh — not a feature scenario.
    it("refreshes the server total so the pager cannot strand an empty page", async () => {
      deleteManyMutate.mockImplementation((_args: unknown, opts?: { onSuccess?: () => void }) =>
        opts?.onSuccess?.(),
      );
      const refetchSpy = vi.fn();
      getAllQuery.mockReset();
      getAllQuery.mockReturnValue({
        data: {
          id: "dp",
          name: "dp",
          columnTypes,
          count: 51,
          totalPages: 2,
          page: 1,
          datasetRecords: [
            { id: "r1", entry: { input: "a", expected_output: "x" } },
            { id: "r2", entry: { input: "b", expected_output: "y" } },
          ],
        },
        isLoading: false,
        isPlaceholderData: false,
        refetch: refetchSpy,
      });

      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetEditorTable datasetId="dp" />);
      await screen.findByText("a");

      await user.click(screen.getByLabelText("Select row 1"));
      await user.click(await screen.findByTestId("delete-selected-rows"));

      // The editor re-reads the page (and thus the whole-dataset count) once the
      // delete settles, instead of trusting the now-stale cached total.
      await waitFor(() => expect(refetchSpy).toHaveBeenCalled(), {
        timeout: 2000,
      });
    });
  });

  describe("when the delete commits but a later update in the batch fails", () => {
    // Regression: count refresh must fire on batch settle via the error path
    // too — not a feature scenario.
    it("still refreshes the total — a committed delete must not be masked by an update error", async () => {
      // Test: delete commits, update fails; collect all callbacks to avoid debounce splitting.
      const resolveDeletes: (() => void)[] = [];
      const rejectUpdates: ((e: { message: string }) => void)[] = [];
      deleteManyMutate.mockImplementation((_args: unknown, opts?: { onSuccess?: () => void }) => {
        if (opts?.onSuccess) resolveDeletes.push(opts.onSuccess);
      });
      updateMutate.mockImplementation(
        (_args: unknown, opts?: { onError?: (e: { message: string }) => void }) => {
          if (opts?.onError) rejectUpdates.push(opts.onError);
        },
      );
      const refetchSpy = vi.fn();
      getAllQuery.mockReset();
      getAllQuery.mockReturnValue({
        data: {
          id: "dp",
          name: "dp",
          columnTypes,
          count: 51,
          totalPages: 2,
          page: 1,
          datasetRecords: [
            { id: "r1", entry: { input: "a", expected_output: "x" } },
            { id: "r2", entry: { input: "b", expected_output: "y" } },
          ],
        },
        isLoading: false,
        isPlaceholderData: false,
        refetch: refetchSpy,
      });

      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetEditorTable datasetId="dp" />);
      await screen.findByText("a");

      // Queue a delete (row 1) and an edit (row 2, now at index 0). The debounce
      // normally carries them in one batch.
      await user.click(screen.getByLabelText("Select row 1"));
      await user.click(await screen.findByTestId("delete-selected-rows"));
      await user.dblClick(screen.getByTestId("cell-0-input_0"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "edited{Enter}");

      // Both mutations dispatched; settle them delete-then-update so ops reaches
      // zero through the error path.
      await waitFor(() => {
        expect(resolveDeletes.length).toBeGreaterThan(0);
        expect(rejectUpdates.length).toBeGreaterThan(0);
      });
      // Deletes first, updates after, so the batch can only reach zero pending
      // ops through the error path however many flushes the debounce produced.
      await act(async () => {
        for (const resolveDelete of resolveDeletes) resolveDelete();
        for (const rejectUpdate of rejectUpdates) {
          rejectUpdate({ message: "boom" });
        }
      });

      expect(refetchSpy).toHaveBeenCalled();
    });
  });
});
