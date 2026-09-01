/**
 * @vitest-environment jsdom
 *
 * Row search in the dataset editor. The transport is mocked, so what these
 * tests pin is the editor's half of the contract: what it asks the server for,
 * and what it does to the grid around a search that is in effect.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetColumns } from "~/server/datasets/types";
import { DatasetEditorTable } from "../DatasetEditorTable";

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
const listPaginatedQuery = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    datasetRecord: {
      getAll: { useQuery: (...args: unknown[]) => listPaginatedQuery(...args) },
      listPaginated: {
        useQuery: (...args: unknown[]) => listPaginatedQuery(...args),
      },
      update: { useMutation: () => ({ mutate: updateMutate }) },
      deleteMany: { useMutation: () => ({ mutate: deleteManyMutate }) },
      create: { useMutation: () => ({ mutate: vi.fn() }) },
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
    useUtils: () => ({}),
  },
}));

const columnTypes: DatasetColumns = [
  { name: "input", type: "string" },
  { name: "expected_output", type: "string" },
];

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/**
 * Serves whatever page the editor asks for. When the request carries a
 * `search`, it answers with the matching subset and a `count` of the matches —
 * the server contract the editor is written against.
 */
const serveDataset = (
  records: { id: string; entry: Record<string, string> }[],
  { pageSize = 50 }: { pageSize?: number } = {},
) => {
  const requests: { page?: number; search?: string }[] = [];
  // Results are cached per (page, search) so repeated renders get the SAME
  // object reference, as react-query would. A fresh object per render feeds the
  // editor's data-keyed effects a new value every time and spins the component
  // into an update loop that has nothing to do with what is under test.
  const cache = new Map<string, unknown>();

  listPaginatedQuery.mockImplementation(
    (input: { page?: number; search?: string }) => {
      const page = input?.page ?? 1;
      const search = input?.search?.trim().toLowerCase();
      const key = `${page}::${search ?? ""}`;
      requests.push({ page, search: input?.search });

      const cached = cache.get(key);
      if (cached) return cached;

      const matching = search
        ? records.filter((r) =>
            Object.values(r.entry).some((v) =>
              v.toLowerCase().includes(search),
            ),
          )
        : records;
      const result = {
        data: {
          id: "ds",
          name: "ds",
          columnTypes,
          count: matching.length,
          totalPages: Math.ceil(matching.length / pageSize),
          page,
          datasetRecords: matching.slice(
            (page - 1) * pageSize,
            page * pageSize,
          ),
        },
        isLoading: false,
        refetch: vi.fn(),
      };
      cache.set(key, result);
      return result;
    },
  );
  return requests;
};

const manyRecords = Array.from({ length: 120 }, (_, i) => ({
  id: `r${i}`,
  entry: {
    input: i === 119 ? "needs escalation" : `question ${i}`,
    expected_output: `answer ${i}`,
  },
}));

/**
 * 120 rows of which 60 say "flagged": the matches span two pages at the default
 * page size while the dataset spans three, so the pager can only be right about
 * one of them.
 */
const twoPagesOfMatches = Array.from({ length: 120 }, (_, i) => ({
  id: `f${i}`,
  entry: {
    input: i < 60 ? `flagged question ${i}` : `plain question ${i}`,
    expected_output: `answer ${i}`,
  },
}));

/** Fits on one page, so the add-row affordances are on screen to begin with. */
const singlePageRecords = [
  { id: "a", entry: { input: "billing question", expected_output: "answer" } },
  { id: "b", entry: { input: "needs escalation", expected_output: "answer" } },
  { id: "c", entry: { input: "password reset", expected_output: "answer" } },
];

/**
 * Serves a different set of records per `datasetId`, so a switch between
 * datasets on a still-mounted editor can be observed.
 */
const serveDatasetsById = (
  byId: Record<string, { id: string; entry: Record<string, string> }[]>,
  { pageSize = 50 }: { pageSize?: number } = {},
) => {
  const requests: { datasetId?: string; page?: number; search?: string }[] = [];
  const cache = new Map<string, unknown>();

  listPaginatedQuery.mockImplementation(
    (input: { datasetId?: string; page?: number; search?: string }) => {
      const datasetId = input?.datasetId ?? "";
      const page = input?.page ?? 1;
      const search = input?.search?.trim().toLowerCase();
      const key = `${datasetId}::${page}::${search ?? ""}`;
      requests.push({ datasetId, page, search: input?.search });

      const cached = cache.get(key);
      if (cached) return cached;

      const records = byId[datasetId] ?? [];
      const matching = search
        ? records.filter((r) =>
            Object.values(r.entry).some((v) =>
              v.toLowerCase().includes(search),
            ),
          )
        : records;
      const result = {
        data: {
          id: datasetId,
          name: datasetId,
          columnTypes,
          count: matching.length,
          totalPages: Math.ceil(matching.length / pageSize),
          page,
          datasetRecords: matching.slice(
            (page - 1) * pageSize,
            page * pageSize,
          ),
        },
        isLoading: false,
        refetch: vi.fn(),
      };
      cache.set(key, result);
      return result;
    },
  );
  return requests;
};

const typeSearch = async (
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) => {
  const box = screen.getByTestId("dataset-row-search");
  await user.type(box, text);
};

beforeEach(() => {
  updateMutate.mockReset();
  deleteManyMutate.mockReset();
  listPaginatedQuery.mockReset();
  // In-memory mode still calls the hook (gated by `enabled`), so it needs a
  // settled-but-empty result rather than undefined.
  listPaginatedQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  });
});

afterEach(() => cleanup());

describe("given a saved dataset", () => {
  describe("when I search for text in a row that is not on this page", () => {
    /** @scenario Find a record that is not on the page I am looking at */
    it("asks the server for the matches and shows the row", async () => {
      const user = userEvent.setup();
      serveDataset(manyRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await typeSearch(user, "escalation");

      await waitFor(() =>
        expect(screen.getByText("needs escalation")).toBeInTheDocument(),
      );
      expect(screen.queryByText("question 0")).not.toBeInTheDocument();
    });

    /** @scenario Searching returns me to the first page of results */
    it("returns to the first page of the matches", async () => {
      const user = userEvent.setup();
      const requests = serveDataset(manyRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await user.click(await screen.findByTestId("pagination-next"));
      await waitFor(() => expect(requests.at(-1)?.page).toBe(2));

      await typeSearch(user, "escalation");

      await waitFor(() => expect(requests.at(-1)?.search).toBe("escalation"));
      expect(requests.at(-1)?.page).toBe(1);
    });

    it("never asks for a page of matches the search has not been applied to", async () => {
      // The page must be reset BEFORE the search reaches the query, not after.
      // Resetting it afterwards fires a real request for (old page, new search)
      // — a page that usually does not exist within the matches, so the answer
      // is an empty page the user briefly sees.
      const user = userEvent.setup();
      const requests = serveDataset(manyRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await user.click(await screen.findByTestId("pagination-next"));
      await waitFor(() => expect(requests.at(-1)?.page).toBe(2));

      await typeSearch(user, "escalation");
      await waitFor(() => expect(requests.at(-1)?.search).toBe("escalation"));

      expect(requests.filter((r) => r.search && (r.page ?? 1) > 1)).toEqual([]);
    });
  });

  describe("when a search is in effect", () => {
    /** @scenario The record count reports the matches, not the whole dataset */
    it("reports the matches alongside the dataset total", async () => {
      const user = userEvent.setup();
      serveDataset(manyRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await typeSearch(user, "escalation");

      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
          "1 of 120",
        ),
      );
    });

    /** @scenario No way to add a row is offered during a search */
    it("withdraws every way of adding a row", async () => {
      // A single-page dataset on purpose: `showAddRow` is already false on any
      // page but the last, so a multi-page fixture would pass this without the
      // search doing anything.
      const user = userEvent.setup();
      serveDataset(singlePageRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      expect(await screen.findByTestId("add-row")).toBeInTheDocument();
      expect(screen.getByTestId("add-rows-from-csv")).toBeInTheDocument();

      await typeSearch(user, "escalation");

      await waitFor(() =>
        expect(screen.queryByTestId("add-row")).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          screen.queryByTestId("add-rows-from-csv"),
        ).not.toBeInTheDocument(),
      );
    });

    /** @scenario A search that matches nothing says so in the grid */
    it("says nothing matched, and repeats what was searched for", async () => {
      const user = userEvent.setup();
      serveDataset(manyRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await typeSearch(user, "zzzznope");

      const empty = await screen.findByTestId("dataset-search-empty");
      expect(empty).toHaveTextContent(/no records match/i);
      expect(empty).toHaveTextContent("zzzznope");
      // "in the grid", not under it: rendered below, the reader is left with a
      // blank bordered box and a sentence that looks unattached to it.
      const grid = screen.getByTestId("dataset-editor-grid");
      expect(grid.parentElement?.contains(empty)).toBe(true);
    });
  });

  describe("when the matches span more than one page", () => {
    /** @scenario The pager pages the matches */
    it("pages the matches rather than the whole dataset", async () => {
      const user = userEvent.setup();
      const requests = serveDataset(twoPagesOfMatches);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      // Three pages before the search.
      expect(
        await screen.findByTestId("pagination-page-3"),
      ).toBeInTheDocument();

      await typeSearch(user, "flagged");
      await waitFor(() => expect(requests.at(-1)?.search).toBe("flagged"));

      // Two after it: the pager follows the matches, not the dataset.
      await waitFor(() =>
        expect(
          screen.queryByTestId("pagination-page-3"),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("pagination-page-2")).toBeInTheDocument();

      await user.click(screen.getByTestId("pagination-next"));
      await waitFor(() => expect(requests.at(-1)?.page).toBe(2));
      expect(requests.at(-1)?.search).toBe("flagged");
    });
  });

  describe("when a row is selected and I then search", () => {
    /** @scenario A selection made before a search does not survive it */
    it("clears the selection, so a delete cannot hit rows I never picked", async () => {
      const user = userEvent.setup();
      serveDataset(singlePageRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      const firstRowCheckbox = (await screen.findAllByRole("checkbox")).at(1)!;
      await user.click(firstRowCheckbox);
      await waitFor(() =>
        expect(screen.getByTestId("delete-selected-rows")).toBeInTheDocument(),
      );

      await typeSearch(user, "escalation");

      await waitFor(() =>
        expect(
          screen.queryByTestId("delete-selected-rows"),
        ).not.toBeInTheDocument(),
      );
    });
  });

  describe("when an edit has not finished saving", () => {
    /** @scenario Searching waits for a pending save */
    it("holds the search until the save settles, so the edit is not stranded", async () => {
      // The mutation never calls back, so the write stays pending — the state
      // in which reloading the grid would drop the edited row's record.
      updateMutate.mockImplementation(() => undefined);
      const user = userEvent.setup();
      serveDataset(singlePageRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await screen.findByText("billing question");
      await user.dblClick(screen.getByTestId("cell-0-input_0"));
      const editor = await screen.findByRole("textbox");
      await user.clear(editor);
      await user.type(editor, "edited{Enter}");

      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-search")).toBeDisabled(),
      );
    });
  });

  describe("when I clear the search", () => {
    /** @scenario Clearing the search restores the whole dataset */
    it("restores the whole dataset and the ways to add a row", async () => {
      const user = userEvent.setup();
      const requests = serveDataset(manyRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await typeSearch(user, "escalation");
      await waitFor(() => expect(requests.at(-1)?.search).toBe("escalation"));

      await user.clear(screen.getByTestId("dataset-row-search"));

      await waitFor(() => expect(requests.at(-1)?.search).toBeUndefined());
      await waitFor(() =>
        expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
          "120 records",
        ),
      );
      expect(screen.getByTestId("add-rows-from-csv")).toBeInTheDocument();
    });

    /** @scenario Clearing the search offers adding rows again */
    it("puts me back on the page I searched from, so the add row I had returns", async () => {
      // The add-row affordances live on the LAST page. Searching from there and
      // returning to page 1 would silently withdraw them for good — the search
      // would have cost the user their place, and the count of pages is the only
      // reason they cannot see it.
      const user = userEvent.setup();
      const requests = serveDataset(manyRecords);
      render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

      await screen.findByText("question 0");
      await user.click(screen.getByTestId("pagination-page-3"));
      await waitFor(() =>
        expect(screen.getByTestId("add-row")).toBeInTheDocument(),
      );

      await typeSearch(user, "escalation");
      await waitFor(() =>
        expect(screen.queryByTestId("add-row")).not.toBeInTheDocument(),
      );

      await user.clear(screen.getByTestId("dataset-row-search"));

      await waitFor(() =>
        expect(screen.getByTestId("add-row")).toBeInTheDocument(),
      );
      expect(screen.getByTestId("add-rows-from-csv")).toBeInTheDocument();
      // Assert the PAGE, not just the add row. The single match makes page 3
      // out of range for the search, so a clamp that fires while the debounce is
      // still catching up would restore the page and then immediately undo it —
      // and every add-row assertion above would still pass on page 1 of a
      // one-page result. The requested page is the only witness that survives.
      await waitFor(() => expect(requests.at(-1)?.search).toBeUndefined());
      expect(requests.at(-1)?.page).toBe(3);
    });
  });
});

describe("given the dataset's own total is not known yet", () => {
  /** @scenario The record count reports the matches, not the whole dataset */
  it("does not pass the match count off as the dataset's total", async () => {
    // The two-number chip remembers the total from the last UNSEARCHED read. If
    // no unsearched read has settled — a slow whole-dataset read, or a remount
    // while a search is active — there is no total to report, and reusing the
    // match count for both halves would state "1 of 1 records" for a dataset of
    // 120: precisely the "the dataset has shrunk" misreading the two numbers
    // exist to prevent. Saying less is the only honest option.
    const user = userEvent.setup();
    // Stable refs per branch — a fresh object each render feeds the editor's
    // data-keyed effects a new value every time and spins it into an update
    // loop, as the note on `serveDataset` describes.
    const pending = { data: undefined, isLoading: true };
    const matched = {
      data: {
        id: "ds",
        name: "ds",
        columnTypes,
        count: 1,
        totalPages: 1,
        page: 1,
        datasetRecords: [{ id: "r119", entry: { input: "needs escalation" } }],
      },
      isLoading: false,
      refetch: vi.fn(),
    };
    listPaginatedQuery.mockImplementation(
      (input: { search?: string } | undefined) =>
        input?.search ? matched : pending,
    );
    render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

    await typeSearch(user, "escalation");

    await waitFor(() =>
      expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
        /matching/,
      ),
    );
    expect(screen.getByTestId("dataset-row-count")).not.toHaveTextContent(
      "1 of 1",
    );
  });
});

describe("given the CSV import was opened just before a search landed", () => {
  /** @scenario An import already open when the search lands is withdrawn too */
  it("withdraws the import dialog too, not just the button", async () => {
    // The toolbar button is withdrawn when a search takes effect, but a click
    // landing inside the debounce opens the dialog while `isSearching` is still
    // false. Leaving it mounted is the same hole the button gate exists to
    // close: rows land at the end of the dataset, outside the matches on screen.
    const user = userEvent.setup();
    serveDataset(singlePageRecords);
    render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

    await screen.findByText("billing question");
    // Typed in one event rather than keystroke by keystroke: this is the click
    // that lands INSIDE the debounce, so the test has to reach the button while
    // the search is still pending. Typing character by character spends most of
    // that window, and the dialog traps focus once open — so opening it first
    // and typing behind it exercises an ordering a user cannot perform.
    fireEvent.change(screen.getByTestId("dataset-row-search"), {
      target: { value: "escalation" },
    });
    await user.click(screen.getByTestId("add-rows-from-csv"));
    await waitFor(() => expect(screen.getAllByRole("dialog").length).toBe(1));

    await waitFor(() =>
      expect(screen.queryByTestId("add-rows-from-csv")).not.toBeInTheDocument(),
    );
    // Waited for, not asserted outright: the dialog's unmount is animated, so a
    // bare assertion here races the exit transition and fails intermittently.
    await waitFor(() =>
      expect(screen.queryAllByRole("dialog")).toHaveLength(0),
    );
  });
});

describe("given the server refuses the search", () => {
  /** @scenario A refused search does not leave unsearched rows on screen as if they matched */
  it("stops presenting the pre-search rows as the result", async () => {
    // The rows on screen were read before the search and never matched against
    // it. The store is only written from a settled `data`, so on error it keeps
    // them — and the chip, fed by the same stale count, labels them as the
    // matches. "50 of 60,000 records" under a search box containing
    // "escalation" is a complete, confident, false answer; the toast that
    // explains it dismisses after 12s and leaves only the falsehood.
    const user = userEvent.setup();
    const loaded = {
      data: {
        id: "ds",
        name: "ds",
        columnTypes,
        count: 120,
        totalPages: 3,
        page: 1,
        datasetRecords: manyRecords.slice(0, 50),
      },
      isLoading: false,
      refetch: vi.fn(),
    };
    const refused = {
      data: undefined,
      error: { message: "This dataset is too large to search" },
      isLoading: false,
      refetch: vi.fn(),
    };
    listPaginatedQuery.mockImplementation(
      (input: { search?: string } | undefined) =>
        input?.search ? refused : loaded,
    );
    render(<DatasetEditorTable datasetId="ds" />, { wrapper: Wrapper });

    await screen.findByText("question 0");
    await typeSearch(user, "escalation");

    await waitFor(() =>
      expect(screen.getByTestId("dataset-search-failed")).toBeInTheDocument(),
    );
    // No match claim: the chip must not report a count of matches it never got.
    expect(screen.getByTestId("dataset-row-count")).not.toHaveTextContent(
      /\bof\b|matching/,
    );
    expect(screen.queryByText("question 0")).not.toBeInTheDocument();
  });
});

describe("given I open another dataset without leaving the editor", () => {
  /** @scenario Opening another dataset starts it unsearched */
  it("drops the previous dataset's search rather than applying it to the new one", async () => {
    // The editor stays mounted across a client-side move between datasets, so
    // every piece of search state is carried over unless it is reset. Carried
    // over, the new dataset is fetched already narrowed by a word the user
    // typed against a different dataset — rows are missing and nothing on
    // screen says why.
    const user = userEvent.setup();
    const requests = serveDatasetsById({
      "ds-a": manyRecords,
      "ds-b": singlePageRecords,
    });
    const { rerender } = render(<DatasetEditorTable datasetId="ds-a" />, {
      wrapper: Wrapper,
    });

    await typeSearch(user, "escalation");
    await waitFor(() => expect(requests.at(-1)?.search).toBe("escalation"));

    rerender(<DatasetEditorTable datasetId="ds-b" />);

    await waitFor(() => expect(requests.at(-1)?.datasetId).toBe("ds-b"));
    expect(requests.filter((r) => r.datasetId === "ds-b" && r.search)).toEqual(
      [],
    );
    expect(screen.getByTestId("dataset-row-search")).toHaveValue("");
  });

  /** @scenario Opening another dataset starts it unsearched */
  it("does not report the new dataset's size as the previous one's", async () => {
    // `unsearchedRecordCount` is remembered so a search can say "3 of 679". Kept
    // across a dataset switch it says "3 of 679" about a dataset that holds 3
    // rows in total — a number the user has no way to recognise as stale.
    const user = userEvent.setup();
    serveDatasetsById({ "ds-a": manyRecords, "ds-b": singlePageRecords });
    const { rerender } = render(<DatasetEditorTable datasetId="ds-a" />, {
      wrapper: Wrapper,
    });

    await typeSearch(user, "escalation");
    await waitFor(() =>
      expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
        "1 of 120",
      ),
    );

    rerender(<DatasetEditorTable datasetId="ds-b" />);

    await waitFor(() =>
      expect(screen.getByTestId("dataset-row-count")).toHaveTextContent(
        "3 records",
      ),
    );
    expect(screen.getByTestId("dataset-row-count")).not.toHaveTextContent(
      "120",
    );
  });

  /** @scenario Opening another dataset starts it unsearched */
  it("starts the new dataset at its first page", async () => {
    // Page is per-dataset too: page 3 of a 120-row dataset is past the end of a
    // 3-row one, and the clamp only corrects it after a request for a page that
    // does not exist has already gone out.
    const user = userEvent.setup();
    const requests = serveDatasetsById({
      "ds-a": manyRecords,
      "ds-b": singlePageRecords,
    });
    const { rerender } = render(<DatasetEditorTable datasetId="ds-a" />, {
      wrapper: Wrapper,
    });

    await user.click(await screen.findByTestId("pagination-next"));
    await waitFor(() => expect(requests.at(-1)?.page).toBe(2));

    rerender(<DatasetEditorTable datasetId="ds-b" />);

    await waitFor(() => expect(requests.at(-1)?.datasetId).toBe("ds-b"));
    expect(
      requests.filter((r) => r.datasetId === "ds-b" && (r.page ?? 1) > 1),
    ).toEqual([]);
  });
});

describe("given a draft dataset that has not been saved", () => {
  /** @scenario A draft dataset offers no search */
  it("offers no search, and still offers the ways to add a row", () => {
    render(
      <DatasetEditorTable
        inMemoryDataset={{
          name: "My Draft",
          columnTypes,
          datasetRecords: [{ id: "r1", input: "hello", expected_output: "x" }],
        }}
        onUpdateDataset={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.queryByTestId("dataset-row-search")).not.toBeInTheDocument();
    expect(screen.getByTestId("add-row")).toBeInTheDocument();
  });
});
