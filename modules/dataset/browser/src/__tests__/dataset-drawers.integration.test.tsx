/**
 * @vitest-environment jsdom
 * Surfaces open dataset's editor by its drawer name; the name must resolve to the editor.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { installedModuleDrawers } from "@langwatch/ui-kernel/module-drawers";
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ closeDrawer: () => void 0 }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_1", slug: "acme" } }),
}));

vi.mock("@langwatch/workflow-browser-kit", () => ({
  tryToMapPreviousColumnsToNewColumns: (records: unknown) => records,
}));

vi.mock("../behavior/dataset-api.ts", () => ({
  datasetApi: {
    dataset: {
      upsert: { useMutation: () => ({ isPending: false, mutate: () => void 0 }) },
      getById: { useQuery: () => ({ data: void 0 }) },
      validateDatasetName: { useQuery: () => ({ refetch: () => Promise.resolve({}) }) },
    },
    useUtils: () => ({ dataset: { getAll: { invalidate: () => void 0 } } }),
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

      render(
        <ChakraProvider value={defaultSystem}>
          <Suspense fallback={null}>
            <Drawer />
          </Suspense>
        </ChakraProvider>,
      );

      expect(
        await screen.findByRole("button", { name: "Create Dataset" }, { timeout: 10_000 }),
      ).toBeTruthy();
    });
  });
});
