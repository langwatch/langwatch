/**
 * @vitest-environment jsdom
 *
 * The row menu's write actions, against the reader's membership.
 *
 * Moved with the screen from
 * `platform/app/src/pages/[project]/__tests__/datasets.lite-member.integration.test.tsx`.
 * The lite `EXTERNAL` role reads every page and writes none of them, so Edit and
 * Delete are not offered to it — the server refuses them either way, and an
 * action that cannot succeed should not be on the menu.
 *
 * The menu is stubbed to plain elements, exactly as the platform suite did, so
 * the assertion is about which items the screen RENDERS rather than about
 * driving an overlay open.
 *
 * Spec: specs/rbac/lite-member-restrictions.feature.
 */

import type { DatasetSummary } from "@langwatch/dataset-contract";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithDatasetHost } from "../../../testing";

const { datasetsQuery } = vi.hoisted(() => ({
  datasetsQuery: {
    current: { data: [] as unknown, isLoading: false, refetch: vi.fn() },
  },
}));

vi.mock("../../../behavior/dataset-api", () => ({
  datasetApi: {
    useUtils: () => ({
      limits: { getUsage: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
    dataset: {
      getAll: { useQuery: () => datasetsQuery.current },
      deleteById: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("../../../ui/sections/add-or-edit-dataset-drawer", () => ({
  AddOrEditDatasetDrawer: () => <div data-testid="add-edit-dataset-drawer" />,
}));
vi.mock("../../../ui/sections/bulk-upload-drawer", () => ({
  BulkUploadDrawer: () => <div data-testid="bulk-upload-drawer" />,
}));
vi.mock("../../../ui/sections/copy-dataset-dialog", () => ({
  CopyDatasetDialog: () => <div data-testid="copy-dataset-dialog" />,
}));

vi.mock("@langwatch/design-system/menu", () => ({
  Menu: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
}));

const { default: DatasetsScreen } = await import("../datasets.screen");

const dataset: DatasetSummary = {
  id: "ds-1",
  projectId: "proj-1",
  name: "Test Dataset",
  slug: "test-dataset",
  columnTypes: [],
  createdAt: new Date("2026-01-01T10:00:00Z"),
  updatedAt: new Date("2026-01-01T10:00:00Z"),
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
  recordCount: 5,
};

describe("Datasets row-menu visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    datasetsQuery.current = { data: [dataset], isLoading: false, refetch: vi.fn() };
  });

  describe("given the reader is not a lite member", () => {
    it("offers edit and delete", () => {
      renderWithDatasetHost(<DatasetsScreen />, { isLiteMember: false });

      expect(screen.getByText("Edit dataset")).toBeTruthy();
      expect(screen.getByText("Delete dataset")).toBeTruthy();
    });
  });

  describe("given the reader is a lite member", () => {
    /** @scenario Lite member does not see edit or delete actions on datasets */
    /** @scenario "The lite membership role is answered by the application, not inferred" */
    it("offers neither edit nor delete", () => {
      renderWithDatasetHost(<DatasetsScreen />, { isLiteMember: true });

      expect(screen.queryByText("Edit dataset")).toBeNull();
      expect(screen.queryByText("Delete dataset")).toBeNull();
      // Replication is a read of this project and a create in another, so it
      // stays: it is not one of the writes the role is barred from here.
      expect(screen.getByText("Replicate to another project")).toBeTruthy();
    });
  });
});
