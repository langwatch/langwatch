/**
 * @vitest-environment jsdom
 * An open workbench follows its saved dataset's read: when the dataset changes elsewhere and the
 * read refetches, the tab's rows refresh, and the edits it has not synced yet stay.
 */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialState } from "../../../model/experiments-v3/types.ts";
import { performRedo, performUndo, useEvaluationsV3Store } from "../use-evaluations-v3-store.ts";
import { useSavedDatasetRecords } from "../use-saved-dataset-loader.ts";

const { server } = vi.hoisted(() => ({
  server: {
    columns: ["question"],
    rows: [] as { id: string; entry: Record<string, string> }[],
    /** Rows the dataset holds beyond the loaded page; zero is a whole read. */
    unloaded: 0,
  },
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1" } }),
}));

vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    datasetRecord: {
      getAll: {
        useQuery: (input: { datasetId: string }, options: { enabled: boolean }) =>
          useQuery({
            queryKey: ["datasetRecord.getAll", input.datasetId],
            enabled: options.enabled,
            queryFn: async () => ({
              columnTypes: server.columns.map((name) => ({ name, type: "string" })),
              datasetRecords: server.rows.map((row) => ({ ...row, entry: { ...row.entry } })),
              truncated: server.unloaded > 0,
              loadedRows: server.rows.length,
              totalRows: server.rows.length + server.unloaded,
            }),
          }),
      },
    },
  },
}));

const TAB = "saved_ds-1";

function openWorkbench() {
  useEvaluationsV3Store.setState({
    ...createInitialState(),
    datasets: [
      {
        id: TAB,
        name: "QA",
        type: "saved",
        datasetId: "ds-1",
        columns: [{ id: "question_0", name: "question", type: "string" }],
      },
    ],
    activeDatasetId: TAB,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  renderHook(() => useSavedDatasetRecords(useEvaluationsV3Store((state) => state.datasets[0])), {
    wrapper,
  });
  return {
    /** What a read hint does in this tab: the dataset's read refetches. */
    hint: () => act(() => client.invalidateQueries({ queryKey: ["datasetRecord.getAll"] })),
  };
}

const shown = () => useEvaluationsV3Store.getState().datasets[0]?.savedRecords;

beforeEach(() => {
  server.unloaded = 0;
  server.columns = ["question"];
  server.rows = [
    { id: "r1", entry: { question: "a" } },
    { id: "r2", entry: { question: "b4" } },
  ];
});

afterEach(() => vi.restoreAllMocks());

describe("given a workbench showing a saved dataset", () => {
  describe("when the dataset is restored elsewhere and its read refetches", () => {
    /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
    it("shows the restored rows without a reload", async () => {
      const { hint } = openWorkbench();
      await waitFor(() => expect(shown()).toHaveLength(2));

      server.rows = [
        { id: "r1", entry: { question: "a-EDITED" } },
        { id: "r2", entry: { question: "b" } },
        { id: "r3", entry: { question: "c" } },
      ];
      await hint();

      await waitFor(() =>
        expect(shown()).toEqual([
          { id: "r1", question: "a-EDITED" },
          { id: "r2", question: "b" },
          { id: "r3", question: "c" },
        ]),
      );
    });
  });

  describe("when the read refetches with other rows and the user edits right after", () => {
    /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
    it("can undo that edit", async () => {
      const { hint } = openWorkbench();
      await waitFor(() => expect(shown()).toHaveLength(2));
      // Past the store's 100 ms window that folds rapid changes into one undo step.
      await new Promise((resolve) => setTimeout(resolve, 150));

      server.rows = [{ id: "r1", entry: { question: "a-EDITED" } }];
      await hint();
      await waitFor(() => expect(shown()).toHaveLength(1));
      const before = useEvaluationsV3Store.getState().name;
      act(() => useEvaluationsV3Store.getState().setName("renamed"));
      act(() => performUndo());

      expect(useEvaluationsV3Store.getState().name).toBe(before);
    });
  });

  describe("when the dataset grows past the loaded page and the loaded rows stay the same", () => {
    let hint: () => Promise<void>;
    const cutTotal = () => useEvaluationsV3Store.getState().datasets[0]?.savedRecordsCut?.totalRows;

    beforeEach(async () => {
      server.unloaded = 1;
      ({ hint } = openWorkbench());
      await waitFor(() => {
        if (shown()?.length !== 2) throw new Error("the first read has not loaded yet");
      });
    });

    /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
    it("updates how many rows the dataset holds", async () => {
      server.unloaded = 5;
      await hint();

      await waitFor(() =>
        expect(useEvaluationsV3Store.getState().datasets[0]?.savedRecordsCut).toEqual({
          loadedRows: 2,
          totalRows: 7,
        }),
      );
    });

    /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
    it("records no undo step for the new row count", async () => {
      const history = () => useEvaluationsV3Store.temporal.getState().pastStates.length;
      // Past the store's 100 ms window that folds rapid changes into one undo step.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const before = history();

      server.unloaded = 5;
      await hint();

      await waitFor(() => expect(cutTotal()).toBe(7));
      expect(history()).toBe(before);
    });

    /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
    it("keeps the new row count when an earlier edit is undone", async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      useEvaluationsV3Store.getState().setName("renamed");
      await new Promise((resolve) => setTimeout(resolve, 150));

      server.unloaded = 5;
      await hint();
      await waitFor(() => expect(cutTotal()).toBe(7));
      act(() => performUndo());

      expect(useEvaluationsV3Store.getState().name).not.toBe("renamed");
      expect(cutTotal()).toBe(7);
      act(() => performRedo());
      expect(cutTotal()).toBe(7);
    });
  });

  describe("when the tab holds an unsynced cell edit as the read refetches", () => {
    /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
    it("keeps the edit over the server's value and takes every other row", async () => {
      const { hint } = openWorkbench();
      await waitFor(() => expect(shown()).toHaveLength(2));
      useEvaluationsV3Store.setState({
        pendingSavedChanges: { "ds-1": { r2: { question: "mine" } } },
      });

      server.rows = [
        { id: "r1", entry: { question: "a-EDITED" } },
        { id: "r2", entry: { question: "b" } },
      ];
      await hint();

      await waitFor(() =>
        expect(shown()).toEqual([
          { id: "r1", question: "a-EDITED" },
          { id: "r2", question: "mine" },
        ]),
      );
    });
  });

  describe("when the refetched read is keyed by other columns than the tab's", () => {
    beforeEach(async () => {
      const { hint } = openWorkbench();
      await waitFor(() => {
        if (shown()?.length !== 2) throw new Error("the first read has not loaded yet");
      });
      server.columns = ["prompt"];
      server.rows = [{ id: "r1", entry: { prompt: "renamed" } }];
      await hint();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
    it("leaves the rows as they are rather than blanking them", () => {
      expect(shown()).toEqual([
        { id: "r1", question: "a" },
        { id: "r2", question: "b4" },
      ]);
    });

    /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
    it("applies the held read once the tab takes the same columns, with no second refetch", async () => {
      act(() =>
        useEvaluationsV3Store.setState((state) => ({
          datasets: state.datasets.map((tab) => ({
            ...tab,
            columns: [{ id: "prompt_0", name: "prompt", type: "string" as const }],
            savedRecords: [
              { id: "r1", prompt: "a" },
              { id: "r2", prompt: "b4" },
            ],
          })),
        })),
      );

      await waitFor(() => expect(shown()).toEqual([{ id: "r1", prompt: "renamed" }]));
    });
  });
});
