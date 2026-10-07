/**
 * @vitest-environment jsdom
 *
 * The lens store writes locally first and mirrors each change to the server.
 * When the server refuses one (a permission, a read only project, a network
 * blip), ana must hear about it, and the strip must end up as the server has
 * it: a refused new lens leaves the strip and she is back on the lens she was
 * on, a refused rename or delete is undone.
 *
 * The lens list runs through a real QueryClient, so the reload behaves as it
 * does in the app. That matters: an empty list refetched as an empty list
 * keeps its reference, so a rollback that waits for the reload never happens
 * on a project's first lens.
 *
 * @see specs/governance/aggregate-project.feature
 */
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from "../../stores/explorerStore";
import { useLensSync } from "../useLensSync";

type LensListInput = { projectId: string; kind: string };
type SavedLensRow = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  updatedAt: Date;
};

const { readLenses, createView, renameView, deleteView, showErrorToast } =
  vi.hoisted(() => ({
    readLenses: vi.fn<(input: LensListInput) => Promise<SavedLensRow[]>>(),
    createView: vi.fn<(input: unknown) => Promise<unknown>>(),
    renameView: vi.fn<(input: unknown) => Promise<unknown>>(),
    deleteView: vi.fn<(input: unknown) => Promise<unknown>>(),
    showErrorToast: vi.fn(),
  }));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", kind: "application" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/features/errors", () => ({ showErrorToast }));

/** The tRPC hooks the lens sync uses, backed by the real react-query. */
vi.mock("~/utils/api", () => {
  const lensListKey = (input: LensListInput) => [
    "savedViews.getAll",
    input.projectId,
    input.kind,
  ];
  const mutationFor =
    (mutationFn: (input: unknown) => Promise<unknown>) =>
    (options: Record<string, unknown>) =>
      useMutation({ ...options, mutationFn });
  return {
    api: {
      useUtils: () => {
        const client = useQueryClient();
        return {
          savedViews: {
            getAll: {
              invalidate: (input: LensListInput) =>
                client.invalidateQueries({ queryKey: lensListKey(input) }),
            },
          },
        };
      },
      savedViews: {
        getAll: {
          useQuery: (
            input: LensListInput,
            options: { enabled?: boolean; staleTime?: number },
          ) =>
            useQuery({
              queryKey: lensListKey(input),
              queryFn: () => readLenses(input),
              enabled: options.enabled,
              staleTime: options.staleTime,
            }),
        },
        create: { useMutation: mutationFor(createView) },
        rename: { useMutation: mutationFor(renameView) },
        delete: { useMutation: mutationFor(deleteView) },
      },
    },
  };
});

const SAVED_LENS: SavedLensRow = {
  id: "custom-saved-1",
  name: "Saved answers",
  filters: {
    v: 1,
    columns: ["time"],
    addons: [],
    grouping: "flat",
    sort: { columnId: "time", direction: "desc" },
    filterText: "",
  },
  updatedAt: new Date("2026-10-01T00:00:00Z"),
};

/** Each read returns fresh Date objects, as the real wire decoding does. */
const serverHas = (rows: SavedLensRow[]) =>
  readLenses.mockImplementation(async () =>
    rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) })),
  );

const refusal = new Error("refused");

const store = () => useExplorerStore.getState();
const lensNamed = (name: string) =>
  store().allLenses.find((lens) => lens.name === name);

let client: QueryClient;

/** Mounts the lens sync and waits until the strip shows the server's lenses. */
async function renderLensSync() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useLensSync(), { wrapper });
  await waitFor(() => expect(readLenses).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      client.getQueryState([
        "savedViews.getAll",
        "proj-1",
        "v2-traces-lens",
      ])?.status,
    ).toBe("success"),
  );
}

/** Waits for the failure to settle and the strip to reload from the server. */
async function waitForReload() {
  await waitFor(() => expect(showErrorToast).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readLenses).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  createView.mockRejectedValue(refusal);
  renameView.mockRejectedValue(refusal);
  deleteView.mockRejectedValue(refusal);
  store().setUserLenses([]);
  store().selectLens("all-traces");
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("useLensSync", () => {
  describe("when the server refuses a project's first lens", () => {
    /** @scenario "A lens the server refuses to save says so and leaves no phantom" */
    it("drops the lens, returns to the lens ana was on, and says so", async () => {
      serverHas([]);
      await renderLensSync();
      act(() => store().selectLens("conversations"));

      act(() => {
        store().createLens("Slow answers");
      });
      await waitForReload();

      expect(lensNamed("Slow answers")).toBeUndefined();
      expect(store().activeLensId).toBe("conversations");
      expect(showErrorToast).toHaveBeenCalledWith({
        error: refusal,
        fallbackTitle: "Couldn't save the lens",
      });
    });
  });

  describe("when the server refuses a new lens on a project with saved lenses", () => {
    /** @scenario "A lens the server refuses to save says so and leaves no phantom" */
    it("drops the lens and returns to the saved lens, not to All traces", async () => {
      serverHas([SAVED_LENS]);
      await renderLensSync();
      await waitFor(() => expect(lensNamed(SAVED_LENS.name)).toBeDefined());
      act(() => store().selectLens(SAVED_LENS.id));

      act(() => {
        store().createLens("Slow answers");
      });
      await waitForReload();

      expect(lensNamed("Slow answers")).toBeUndefined();
      expect(store().activeLensId).toBe(SAVED_LENS.id);
    });
  });

  describe("when the server refuses a duplicated lens", () => {
    /** @scenario "A lens the server refuses to save says so and leaves no phantom" */
    it("drops the copy and returns to the lens it was copied from", async () => {
      serverHas([]);
      await renderLensSync();
      act(() => store().selectLens("errors"));

      act(() => {
        store().duplicateLens("errors");
      });
      await waitForReload();

      expect(lensNamed("Errors (copy)")).toBeUndefined();
      expect(store().activeLensId).toBe("errors");
    });
  });

  describe("when the server refuses renaming a saved lens", () => {
    /** @scenario "A lens the server refuses to save says so and leaves no phantom" */
    it("keeps the saved name and says so", async () => {
      serverHas([SAVED_LENS]);
      await renderLensSync();
      await waitFor(() => expect(lensNamed(SAVED_LENS.name)).toBeDefined());

      act(() => store().renameLens(SAVED_LENS.id, "Renamed"));
      await waitForReload();

      expect(lensNamed("Renamed")).toBeUndefined();
      expect(lensNamed(SAVED_LENS.name)).toBeDefined();
      expect(showErrorToast).toHaveBeenCalledWith({
        error: refusal,
        fallbackTitle: "Couldn't rename the lens",
      });
    });
  });

  describe("when the server refuses deleting a saved lens", () => {
    /** @scenario "A lens the server refuses to save says so and leaves no phantom" */
    it("brings the lens back and says so", async () => {
      serverHas([SAVED_LENS]);
      await renderLensSync();
      await waitFor(() => expect(lensNamed(SAVED_LENS.name)).toBeDefined());

      act(() => store().deleteLens(SAVED_LENS.id));
      await waitForReload();

      expect(lensNamed(SAVED_LENS.name)).toBeDefined();
      expect(showErrorToast).toHaveBeenCalledWith({
        error: refusal,
        fallbackTitle: "Couldn't delete the lens",
      });
    });
  });
});
