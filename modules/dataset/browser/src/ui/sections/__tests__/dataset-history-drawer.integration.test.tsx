/**
 * @vitest-environment jsdom
 * The dataset history drawer over a fake dataset router that keeps its versions in memory,
 * so a save shows up the way the cache write makes it and a restore the way its read hint does.
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetVersionListItem } from "../../../model/dataset-version-history.ts";
import { renderWithDatasetHost } from "../../../testing.tsx";

const fake = vi.hoisted(() => {
  type Listener = () => void;
  const listeners = new Set<Listener>();
  const state = {
    history: { versions: [] as unknown[], restorable: true },
    dataset: { name: "Support questions" },
  };
  return {
    state,
    listeners,
    setHistory(next: { versions: unknown[]; restorable: boolean }) {
      state.history = next;
      for (const listener of listeners) listener();
    },
    saveVersion: vi.fn(),
    restoreVersion: vi.fn(),
    versionPage: vi.fn(),
    compareVersion: vi.fn(),
    closeDrawer: vi.fn(),
  };
});

vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDrawer: () => ({ closeDrawer: fake.closeDrawer }),
}));

function useVersions() {
  const versions = useSyncExternalStore(
    (listener) => {
      fake.listeners.add(listener);
      return () => fake.listeners.delete(listener);
    },
    () => fake.state.history,
  );
  return { data: versions, isLoading: false, isError: false, refetch: vi.fn() };
}

vi.mock("@langwatch/dataset-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  datasetClient: {
    useUtils: () => ({
      dataset: {
        versions: {
          setData: (
            _input: unknown,
            update: (current: typeof fake.state.history) => typeof fake.state.history,
          ) => fake.setHistory(update(fake.state.history)),
        },
      },
    }),
    dataset: {
      getById: { useQuery: () => ({ data: fake.state.dataset, isSuccess: true }) },
      versions: { useQuery: useVersions },
      saveVersion: { useMutation: () => ({ mutateAsync: fake.saveVersion, isPending: false }) },
      restoreVersion: {
        useMutation: () => ({ mutateAsync: fake.restoreVersion, isPending: false }),
      },
      versionPage: {
        useQuery: (input: { version: number }, options: { enabled: boolean }) =>
          options.enabled
            ? { data: fake.versionPage(input), isLoading: false, isError: false, isFetching: false }
            : { data: undefined, isLoading: false, isError: false, isFetching: false },
      },
      compareVersion: {
        useQuery: (input: { version: number }, options: { enabled: boolean }) =>
          options.enabled
            ? { data: fake.compareVersion(input), isLoading: false, isError: false }
            : { data: undefined, isLoading: false, isError: false },
      },
    },
  },
}));

const { DatasetHistoryDrawer } = await import("../dataset-history-drawer.tsx");

const MINUTE = 60_000;

function makeVersion(overrides: Partial<DatasetVersionListItem>): DatasetVersionListItem {
  const version = overrides.version ?? 1;
  return {
    id: `ver-${version}`,
    projectId: "proj-1",
    datasetId: "ds-1",
    version,
    name: null,
    trigger: "autosave",
    contentHash: `hash-${version}`,
    columnTypes: [
      { name: "input", type: "string" },
      { name: "output", type: "string" },
    ],
    rowCount: 3,
    sizeBytes: 100,
    chunkCount: 1,
    restoredFromVersion: null,
    authorId: "user-1",
    authorKind: "user",
    authorName: null,
    pinned: false,
    runCount: 0,
    createdAt: new Date(Date.now() - 5 * MINUTE).toISOString(),
    ...overrides,
  };
}

const VERSION_1 = makeVersion({
  version: 1,
  trigger: "initial",
  authorId: "user-2",
  authorName: "Ada Lovelace",
  rowCount: 3,
  createdAt: new Date(Date.now() - 90 * MINUTE).toISOString(),
});
const VERSION_2 = makeVersion({
  version: 2,
  trigger: "manual",
  name: "Before relabel",
  authorKind: "api_key",
  authorId: "key-1",
  runCount: 2,
  pinned: true,
});

const renderDrawer = (options: { permissions?: string[] } = {}) =>
  renderWithDatasetHost(<DatasetHistoryDrawer datasetId="ds-1" />, {
    permissions: options.permissions ?? ["datasets:view", "datasets:update", "datasets:manage"],
    currentUserId: "user-1",
  });

/** The drawer moves focus in once it opens; typing before then lands nowhere. */
async function waitForDrawerFocus() {
  await waitFor(() => expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull());
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, version: number) {
  await user.click(screen.getByRole("button", { name: `Actions for version ${version}` }));
}

describe("Dataset history drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.listeners.clear();
    fake.state.history = { versions: [VERSION_2, VERSION_1], restorable: true };
    fake.state.dataset = { name: "Support questions" };
  });

  describe("given a dataset with versions", () => {
    /** @scenario "The history drawer lists versions and saves one by hand" */
    it("lists the versions with author and time, and saves a named version", async () => {
      const user = userEvent.setup();
      fake.saveVersion.mockImplementation(async (input: { name?: string }) =>
        makeVersion({
          version: 3,
          trigger: "manual",
          name: input.name ?? null,
          authorId: "user-1",
        }),
      );
      const { host } = renderDrawer();

      const second = screen.getByTestId("dataset-version-2");
      expect(within(second).getByText("Version 2 · Before relabel")).toBeInTheDocument();
      expect(within(second).getByText("Saved by hand")).toBeInTheDocument();
      expect(within(second).getByText("API key")).toBeInTheDocument();
      expect(within(second).getByText(/Used by 2 runs/)).toBeInTheDocument();
      expect(within(second).getByText(/ago$/)).toBeInTheDocument();
      expect(within(second).getByText("Latest")).toBeInTheDocument();

      const first = screen.getByTestId("dataset-version-1");
      expect(within(first).getByText("First version")).toBeInTheDocument();
      expect(within(first).getByText("Ada Lovelace")).toBeInTheDocument();
      expect(within(first).getByText("3 rows")).toBeInTheDocument();

      await waitForDrawerFocus();
      await user.type(screen.getByRole("textbox", { name: "Version name" }), "Baseline");
      await user.click(screen.getByRole("button", { name: "Save version" }));

      await waitFor(() =>
        expect(fake.saveVersion).toHaveBeenCalledWith({
          projectId: "proj-1",
          datasetId: "ds-1",
          name: "Baseline",
        }),
      );
      const third = await screen.findByTestId("dataset-version-3");
      expect(within(third).getByText("Version 3 · Baseline")).toBeInTheDocument();
      expect(within(third).getByText("You")).toBeInTheDocument();
      expect(host.successes).toEqual([{ title: "Saved version 3" }]);
      expect(screen.getByRole("textbox", { name: "Version name" })).toHaveValue("");
    });

    it("saves without a name when the field is left empty", async () => {
      const user = userEvent.setup();
      fake.saveVersion.mockResolvedValue(makeVersion({ version: 3, trigger: "manual" }));
      renderDrawer();

      await user.click(screen.getByRole("button", { name: "Save version" }));

      await waitFor(() =>
        expect(fake.saveVersion).toHaveBeenCalledWith({ projectId: "proj-1", datasetId: "ds-1" }),
      );
    });

    it("reports a failed save through the host", async () => {
      const user = userEvent.setup();
      const error = new Error("dataset_not_ready");
      fake.saveVersion.mockRejectedValue(error);
      const { host } = renderDrawer();

      await user.click(screen.getByRole("button", { name: "Save version" }));

      await waitFor(() =>
        expect(host.failures).toEqual([{ error, fallbackTitle: "Couldn't save a version" }]),
      );
    });

    it("shows a version's rows read-only", async () => {
      const user = userEvent.setup();
      fake.versionPage.mockReturnValue({
        version: VERSION_1,
        rows: [
          { id: "r1", entry: { input: "What is LangWatch?", output: "An LLM ops platform" } },
          { id: "r2", entry: { input: "Pricing?", output: "" } },
        ],
        pagination: { page: 1, limit: 25, total: 2 },
      });
      renderDrawer();

      await openRowMenu(user, 1);
      await user.click(await screen.findByRole("menuitem", { name: "View rows" }));

      expect(fake.versionPage).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));
      expect(await screen.findByText("What is LangWatch?")).toBeInTheDocument();
      expect(screen.getByText("An LLM ops platform")).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "input" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("cannot restore the latest version", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await openRowMenu(user, 2);

      expect(await screen.findByRole("menuitem", { name: "Restore this version" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
  });

  describe("given a reader who may not edit the dataset", () => {
    it("lists the versions but offers no save or restore", async () => {
      const user = userEvent.setup();
      renderDrawer({ permissions: ["datasets:view"] });

      expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
      await openRowMenu(user, 1);
      expect(await screen.findByRole("menuitem", { name: "Restore this version" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
  });

  describe("given a member who may edit the dataset but not manage it", () => {
    /** @scenario "Restoring a version needs permission to manage the dataset" */
    it("saves a version but disables restore with a reason", async () => {
      const user = userEvent.setup();
      renderDrawer({ permissions: ["datasets:view", "datasets:update"] });

      expect(screen.getByRole("button", { name: "Save version" })).toBeEnabled();
      await openRowMenu(user, 1);
      expect(await screen.findByRole("menuitem", { name: "Restore this version" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
  });

  describe("given a dataset in the legacy single-file layout", () => {
    it("explains that its versions cannot be restored", async () => {
      const user = userEvent.setup();
      fake.state.history = { versions: [VERSION_2, VERSION_1], restorable: false };
      fake.compareVersion.mockReturnValue({
        version: 1,
        columns: { added: [], removed: [] },
        counts: { added: 0, removed: 0, changed: 0, unchanged: 3 },
        added: [],
        removed: [],
        changed: [],
        truncated: false,
      });
      renderDrawer();

      await openRowMenu(user, 1);
      await user.click(await screen.findByRole("menuitem", { name: "Compare with current" }));

      expect(await screen.findByText("Version 1 matches the current content.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Restore this version" })).toBeDisabled();
      expect(screen.getByLabelText(/older single-file layout/)).toBeInTheDocument();
    });
  });

  describe("given the history drawer of a dataset with versions 1 and 2", () => {
    /** @scenario "The history drawer compares and restores a version" */
    it("compares version 1 with the current content, then restores it as a new version", async () => {
      const user = userEvent.setup();
      fake.compareVersion.mockReturnValue({
        version: 1,
        columns: { added: ["expected"], removed: ["notes"] },
        counts: { added: 1, removed: 1, changed: 1, unchanged: 4 },
        added: [{ id: "d", entry: { input: "Row d is new" } }],
        removed: [{ id: "b", entry: { input: "Row b was deleted" } }],
        changed: [
          {
            id: "a",
            before: { input: "Row a", output: "old answer" },
            after: { input: "Row a", output: "new answer" },
          },
        ],
        truncated: true,
      });
      const restoredVersion = makeVersion({
        version: 3,
        trigger: "restore",
        restoredFromVersion: 1,
        authorId: "user-1",
      });
      fake.restoreVersion.mockImplementation(async () => {
        // The restore's read hint refetches the history; the drawer writes no cache itself.
        fake.setHistory({ versions: [restoredVersion, VERSION_2, VERSION_1], restorable: true });
        return { changed: true, version: restoredVersion };
      });
      const { host } = renderDrawer();

      await openRowMenu(user, 1);
      await user.click(await screen.findByRole("menuitem", { name: "Compare with current" }));

      expect(fake.compareVersion).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "proj-1", datasetId: "ds-1", version: 1 }),
      );
      const summary = await screen.findByLabelText("Summary");
      expect(within(summary).getByText("1 added")).toBeInTheDocument();
      expect(within(summary).getByText("1 removed")).toBeInTheDocument();
      expect(within(summary).getByText("1 changed")).toBeInTheDocument();
      expect(within(summary).getByText("4 unchanged")).toBeInTheDocument();
      expect(screen.getByText("Added since version 1: expected")).toBeInTheDocument();
      expect(screen.getByText("Removed since version 1: notes")).toBeInTheDocument();
      expect(screen.getByText("Only the first rows of each kind are listed")).toBeInTheDocument();

      const added = screen.getByRole("region", { name: "Added since version 1" });
      expect(within(added).getByText("Row d is new")).toBeInTheDocument();
      const removed = screen.getByRole("region", { name: "Removed since version 1" });
      expect(within(removed).getByText("Row b was deleted")).toBeInTheDocument();
      const changed = screen.getByRole("region", { name: "Changed since version 1" });
      expect(within(changed).getByText("old answer")).toBeInTheDocument();
      expect(within(changed).getByText("new answer")).toBeInTheDocument();
      expect(within(changed).queryByText("input")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Restore this version" }));
      const dialog = await screen.findByRole("dialog", { name: "Restore version 1?" });
      expect(fake.restoreVersion).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole("button", { name: "Restore" }));

      await waitFor(() =>
        expect(fake.restoreVersion).toHaveBeenCalledWith({
          projectId: "proj-1",
          datasetId: "ds-1",
          version: 1,
        }),
      );
      expect(
        await screen.findByText("Restored from version 1", {}, { timeout: 5_000 }),
      ).toBeInTheDocument();
      expect(host.successes).toEqual([
        { title: "Restored version 1", description: "Saved as version 3." },
      ]);
    });

    it("leaves the dataset alone when the confirmation is cancelled", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await openRowMenu(user, 1);
      await user.click(await screen.findByRole("menuitem", { name: "Restore this version" }));
      const dialog = await screen.findByRole("dialog", { name: "Restore version 1?" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Restore version 1?" }),
        ).not.toBeInTheDocument(),
      );
      expect(fake.restoreVersion).not.toHaveBeenCalled();
    });
  });
});
