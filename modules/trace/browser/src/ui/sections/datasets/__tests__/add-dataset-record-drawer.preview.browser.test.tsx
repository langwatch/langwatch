/**
 * The Add to Dataset preview at 1280 wide: every column reachable by sideways
 * scroll inside its card, and a cell editor that opens on double-click, stays
 * in the dialog and closes on the first Escape alone. Real layout and keys.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

const harness = vi.hoisted(() => {
  const navigate = (url: string) => {
    window.history.replaceState({}, "", url);
    return Promise.resolve(true);
  };
  const columnTypes = [
    "trace_id",
    "timestamp",
    "input",
    "output",
    "contexts",
    "total_cost",
    "annotations",
  ].map((name) => ({ name, type: "string" as const }));
  const mapping = {
    trace_id: { source: "trace_id" },
    timestamp: { source: "timestamp" },
    input: { source: "input" },
    output: { source: "output" },
    contexts: { source: "contexts.string_list" },
    total_cost: { source: "metrics.total_cost" },
    annotations: { source: "annotations" },
  };
  return {
    columnTypes,
    mapping,
    router: {
      get query() {
        const query: Record<string, string> = {};
        new URLSearchParams(window.location.search).forEach((value, key) => {
          query[key] = value;
        });
        return query;
      },
      pathname: "/[project]/traces",
      get asPath() {
        return window.location.pathname + window.location.search;
      },
      push: navigate,
      replace: navigate,
    },
  };
});

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  default: harness.router,
  useRouter: () => harness.router,
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "my-project" } }),
}));

vi.mock("../../../../behavior/use-local-storage-selected-dataset-id.ts", () => ({
  useLocalStorageSelectedDataSetId: () => ({
    selectedDataSetId: "dataset-1",
    setSelectedDataSetId: () => Promise.resolve(),
    rememberCreatedDataset: vi.fn(),
  }),
}));

vi.mock("../../use-project-span-names.ts", () => ({
  useProjectSpanNames: () => ({ spanNames: [], metadataKeys: [], isLoading: false, error: null }),
}));
vi.mock("../../use-project-event-types.ts", () => ({
  useProjectEventTypes: () => ({ eventTypes: [], isLoading: false }),
}));
vi.mock("../../../../behavior/use-annotations-by-trace-ids.ts", () => ({
  useAnnotationsByTraceIds: () => ({ data: [] }),
}));

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: {
    useUtils: () => ({ dataset: { getAll: { invalidate: vi.fn() } } }),
    annotationScore: { getAllActive: { useQuery: () => ({ data: [] }) } },
    traces: {
      getTracesWithSpans: {
        useQuery: () => ({
          data: [
            {
              trace_id: "9091eb0e1b016a6fc9e0baf6c585e55d5",
              project_id: "project-1",
              metadata: {},
              timestamps: { started_at: 1_700_000_000_000, inserted_at: 1, updated_at: 1 },
              input: { value: "third message" },
              output: { value: "The prompt was rewritten three times until the tone was right" },
              metrics: { total_cost: 0.00013099999999999999 },
              spans: [],
            },
          ],
        }),
      },
      getTracesWithSpansByThreadIds: { useQuery: () => ({ data: undefined }) },
      getFormattedSpansDigest: { useQuery: () => ({ data: undefined }) },
      getSampleTracesDataset: { useQuery: () => ({ data: [] }) },
    },
  },
}));

vi.mock("@langwatch/dataset-client", () => ({
  AddOrEditDatasetRoutedDrawerToken: { key: "addOrEditDataset" },
  datasetClient: {
    useUtils: () => ({
      dataset: { getAll: { invalidate: vi.fn() } },
      datasetRecord: { getAll: { invalidate: vi.fn() } },
    }),
    dataset: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "dataset-1",
              name: "offline evals",
              columnTypes: harness.columnTypes,
              mapping: { traceMapping: { mapping: harness.mapping, expansions: [] } },
            },
          ],
          isLoading: false,
          isError: false,
          refetch: () => Promise.resolve(),
        }),
      },
      updateMapping: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    datasetRecord: {
      create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("../dataset-selector.tsx", () => ({ DatasetSelector: () => null }));
vi.mock("@langwatch/design-system/toaster", () => ({ toaster: { create: vi.fn() } }));

import { useDrawer } from "@langwatch/browser-host/drawer";

import { AddDatasetRecordDrawer } from "../add-dataset-record-drawer.tsx";

function OpenFromSelection() {
  const { openDrawer } = useDrawer();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openDrawer("addDatasetRecord", { selectedTraceIds: ["trace-1"] });
  }, [openDrawer]);
  return null;
}

/** The routed drawer is open while its `open` key is in the address. */
function drawerInUrl(): Record<string, string> {
  const drawer: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key.startsWith("drawer.")) drawer[key.replace("drawer.", "")] = value;
  });
  return drawer;
}

const dialog = () => screen.getByRole("dialog");
const previewTable = () => screen.getByTestId("dataset-preview-table");
const lastCell = () => {
  const cells = previewTable().querySelectorAll<HTMLElement>("tbody tr:last-child td");
  return cells[cells.length - 1] as HTMLElement;
};

beforeAll(async () => {
  await page.viewport(1280, 800);
});

beforeEach(() => {
  window.history.replaceState({}, "", "/my-project/traces");
});

afterEach(() => cleanup());

async function openPreview() {
  renderWithDesignSystem(
    <>
      <OpenFromSelection />
      <AddDatasetRecordDrawer />
    </>,
  );
  await screen.findByTestId("dataset-preview-table");
  await waitFor(() => expect(previewTable().querySelector("tbody tr")).not.toBeNull());
}

describe("given the Add to Dataset preview at 1280 wide", () => {
  describe("when the preview has more columns than its card can show", () => {
    /** @scenario "The Add to Dataset preview scrolls sideways inside its card" */
    it("keeps the card inside the dialog and scrolls the table within it", async () => {
      await openPreview();
      const card = previewTable().parentElement as HTMLElement;

      const dialogBox = dialog().getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      expect(cardBox.right).toBeLessThanOrEqual(dialogBox.right);
      expect(card.scrollWidth).toBeGreaterThan(card.clientWidth);
      expect(getComputedStyle(card).overflowX).toBe("auto");
    });

    /** @scenario "The Add to Dataset preview scrolls sideways inside its card" */
    it("brings the last column into view when scrolled to the end", async () => {
      await openPreview();
      const card = previewTable().parentElement as HTMLElement;

      card.scrollLeft = card.scrollWidth;

      const cardBox = card.getBoundingClientRect();
      const cellBox = lastCell().getBoundingClientRect();
      expect(cellBox.right).toBeLessThanOrEqual(cardBox.right + 1);
      expect(cellBox.left).toBeGreaterThanOrEqual(cardBox.left);
      const header = previewTable().querySelector<HTMLElement>("thead th:last-child");
      expect(header?.scrollWidth).toBeLessThanOrEqual((header?.clientWidth ?? 0) + 1);
    });
  });

  describe("when I double-click the last row's right-most cell", () => {
    /** @scenario "Escape in Add to Dataset leaves the drawer open while a cell editor is open" */
    it("opens an editor inside the dialog that Escape closes before the dialog", async () => {
      await openPreview();
      const card = previewTable().parentElement as HTMLElement;
      card.scrollLeft = card.scrollWidth;

      await userEvent.dblClick(lastCell());

      const editor = await waitFor(() => {
        const found = document.querySelector<HTMLElement>("[data-floating-cell-editor]");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      const dialogBox = dialog().getBoundingClientRect();
      const editorBox = editor.getBoundingClientRect();
      expect(editorBox.left).toBeGreaterThanOrEqual(dialogBox.left);
      expect(editorBox.right).toBeLessThanOrEqual(dialogBox.right);
      expect(editorBox.top).toBeGreaterThanOrEqual(dialogBox.top);
      expect(editorBox.bottom).toBeLessThanOrEqual(dialogBox.bottom);

      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(document.querySelector("[data-floating-cell-editor]")).toBeNull());
      expect(drawerInUrl()).toMatchObject({ open: "addDatasetRecord" });

      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(drawerInUrl()).toEqual({}));
    });
  });
});
