/**
 * @vitest-environment jsdom
 * Surfaces open dataset's editor by its drawer name; the name must resolve to the editor.
 */

import { installedModuleDrawers } from "@langwatch/browser/module-drawers";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ closeDrawer: () => void 0 }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_1", slug: "acme" } }),
}));

vi.mock("../model/workflow/studio-dataset.utils.ts", () => ({
  tryToMapPreviousColumnsToNewColumns: (records: unknown) => records,
}));

vi.mock("../behavior/dataset-api.ts", () => ({
  datasetApi: {
    useUtils: () => ({ dataset: { getAll: { invalidate: () => void 0 } } }),
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({ dataset: { getAll: { invalidate: () => void 0 } } }),
    dataset: {
      upsert: { useMutation: () => ({ isPending: false, mutate: () => void 0 }) },
      getById: { useQuery: () => ({ data: void 0 }) },
      validateDatasetName: { useQuery: () => ({ refetch: () => Promise.resolve({}) }) },
    },
  },
}));

import { datasetWeb } from "../dataset.web.ts";

describe("given a browser that installs dataset", () => {
  describe("when a surface opens the addOrEditDataset drawer", () => {
    /** @scenario "The dataset editor opens by its drawer name" */
    it("mounts dataset's create-or-edit editor", async () => {
      const Drawer = installedModuleDrawers([datasetWeb]).addOrEditDataset;
      expect(Drawer).toBeDefined();
      if (!Drawer) return;

      renderWithDesignSystem(
        <Suspense fallback={null}>
          <Drawer />
        </Suspense>,
      );

      expect(
        await screen.findByRole("button", { name: "Create Dataset" }, { timeout: 10_000 }),
      ).toBeTruthy();
    });
  });
});
