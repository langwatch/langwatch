/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Datasets list screen: listing with key facts,
 * search, navigation, the loading state and the empty state.
 *
 * Moved with the screen from
 * `platform/app/src/pages/[project]/__tests__/datasets-list.integration.test.tsx`
 * and `platform/app/src/pages/__tests__/datasets-list-loading.integration.test.tsx`.
 * What changed is which modules are mocked, not what is asserted — with one
 * exception, recorded here because it is a real behaviour change: the platform
 * fixtures carried `_count.datasetRecords`, a shape `dataset.getAll` does not
 * actually return. The rows below carry `recordCount`, which is what the
 * procedure hands the screen, and `datasetDisplayRecordCount` now reads it.
 *
 * Spec: specs/datasets/datasets-list-page.feature.
 */

import type { DatasetSummary } from "@langwatch/dataset-contract";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithDatasetHost } from "../../../testing";

const { datasetsQuery, mockDeleteMutate } = vi.hoisted(() => ({
  datasetsQuery: {
    current: { data: undefined, isLoading: false, refetch: vi.fn() } as {
      data: unknown;
      isLoading: boolean;
      refetch: () => void;
    },
  },
  mockDeleteMutate: vi.fn(),
}));

vi.mock("../../../behavior/dataset-api", () => ({
  datasetApi: {
    useUtils: () => ({
      limits: { getUsage: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
    dataset: {
      getAll: { useQuery: () => datasetsQuery.current },
      deleteById: { useMutation: () => ({ mutate: mockDeleteMutate, isPending: false }) },
    },
  },
}));

// The three overlays have their own suites; here they only have to be absent
// until the screen opens them.
vi.mock("../../../ui/sections/add-or-edit-dataset-drawer", () => ({
  AddOrEditDatasetDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-edit-dataset-drawer" /> : null,
}));
vi.mock("../../../ui/sections/bulk-upload-drawer", () => ({
  BulkUploadDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="bulk-upload-drawer" /> : null,
}));
vi.mock("../../../ui/sections/copy-dataset-dialog", () => ({
  CopyDatasetDialog: () => <div data-testid="copy-dataset-dialog" />,
}));

const { default: DatasetsScreen } = await import("../datasets.screen");

const makeDataset = (id: string, name: string, records: number): DatasetSummary => ({
  id,
  projectId: "proj-1",
  name,
  slug: id,
  columnTypes: [
    { name: "input", type: "string" },
    { name: "expected_output", type: "string" },
  ],
  createdAt: new Date("2026-01-01T10:00:00Z"),
  updatedAt: new Date("2026-02-02T10:00:00Z"),
  archivedAt: null,
  mapping: null,
  useS3: false,
  s3RecordCount: null,
  contentLayout: "postgres",
  status: "ready",
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: null,
  sizeBytes: null,
  chunkCount: null,
  chunkOffsets: null,
  recordCount: records,
});

describe("Datasets list screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    datasetsQuery.current = {
      data: [
        makeDataset("ds-1", "offline evals", 12),
        makeDataset("ds-2", "production samples", 3),
      ],
      isLoading: false,
      refetch: vi.fn(),
    };
  });

  describe("given the project has datasets", () => {
    /** @scenario Datasets are listed with their key facts */
    it("lists each dataset with name, columns, entry count, and last update", () => {
      renderWithDatasetHost(<DatasetsScreen />);

      expect(screen.getByText("offline evals")).toBeInTheDocument();
      expect(screen.getByText("production samples")).toBeInTheDocument();
      expect(screen.getAllByText("input")).toHaveLength(2);
      expect(screen.getAllByText("expected_output")).toHaveLength(2);
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      // Last update uses updatedAt, not createdAt.
      const expected = new Date("2026-02-02T10:00:00Z").toLocaleString();
      expect(screen.getAllByText(expected)).toHaveLength(2);
    });

    describe("when the reader searches", () => {
      /** @scenario Search datasets by name */
      it("filters the list as they type", async () => {
        const user = userEvent.setup();
        renderWithDatasetHost(<DatasetsScreen />);

        await user.type(screen.getByTestId("datasets-search"), "offline");

        await waitFor(() =>
          expect(screen.queryByText("production samples")).not.toBeInTheDocument(),
        );
        expect(screen.getByText("offline evals")).toBeInTheDocument();
      });

      it("shows a no-results hint when the search matches nothing", async () => {
        const user = userEvent.setup();
        renderWithDatasetHost(<DatasetsScreen />);

        await user.type(screen.getByTestId("datasets-search"), "zzz");

        expect(await screen.findByText(/No datasets match "zzz"/i)).toBeInTheDocument();
      });
    });

    describe("when a row is clicked", () => {
      /** @scenario Open a dataset */
      it("navigates to that dataset's editor", async () => {
        const user = userEvent.setup();
        const { host } = renderWithDatasetHost(<DatasetsScreen />);

        await user.click(screen.getByText("offline evals"));

        expect(host.navigations).toEqual(["/test-project/datasets/ds-1"]);
      });
    });
  });

  describe("given the datasets are still being fetched", () => {
    beforeEach(() => {
      datasetsQuery.current = { data: undefined, isLoading: true, refetch: vi.fn() };
    });

    /** @scenario "The list loads while I wait, and tells me it is loading" */
    it("shows loading placeholders instead of the empty-project message", () => {
      const { container } = renderWithDatasetHost(<DatasetsScreen />);

      expect(container.querySelectorAll("[class*='chakra-skeleton']").length).toBeGreaterThan(0);
      expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
      // The table's own scaffolding is up, so the page does not jump when the
      // rows land.
      expect(screen.getByText("Entries")).toBeInTheDocument();
    });
  });

  describe("given the project has no datasets", () => {
    beforeEach(() => {
      datasetsQuery.current = { data: [], isLoading: false, refetch: vi.fn() };
    });

    /** @scenario Empty project shows a helpful empty state */
    it("shows the empty state with an upload-or-create CTA", async () => {
      const user = userEvent.setup();
      renderWithDatasetHost(<DatasetsScreen />);

      expect(screen.getByText("No datasets yet")).toBeInTheDocument();
      await user.click(screen.getByTestId("empty-state-create-dataset"));
      // The CTA is a dropdown: "Create empty dataset" opens the create drawer.
      await user.click(await screen.findByText("Create empty dataset"));
      expect(await screen.findByTestId("add-edit-dataset-drawer")).toBeInTheDocument();
    });

    /** @scenario Empty-state CTA can launch the bulk upload flow */
    it("opens the bulk upload drawer from the empty-state CTA", async () => {
      const user = userEvent.setup();
      renderWithDatasetHost(<DatasetsScreen />);

      await user.click(screen.getByTestId("empty-state-create-dataset"));
      await user.click(await screen.findByText("Upload datasets"));
      expect(await screen.findByTestId("bulk-upload-drawer")).toBeInTheDocument();
    });
  });
});
