/**
 * What a browser installs when it installs dataset: the datasets list and
 * the dataset editor. `publishSurfaces` was superseded by the kit
 * (ARCHITECTURE.md §14, ruled 2026-09-18) and is deleted here.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const datasetWeb = defineWebModule("dataset")
  .withHosts({
    requires: ["DatasetHostApi"],
    mounts: { DatasetHostApi: { load: () => import("./behavior/dataset-host-mount.tsx") } },
  })
  .withScreens({
    "pages/[project]/datasets": {
      path: "/:project/datasets",
      within: "project",
      label: "Datasets",
      load: () => import("./ui/sections/datasets.screen.tsx"),
    },
    "pages/[project]/datasets/[id]": {
      path: "/:project/datasets/:id",
      within: "project",
      load: () => import("./ui/sections/dataset-editor.screen.tsx"),
    },
  })
  .withDrawers({
    selectDataset: {
      load: async () => ({
        default: (await import("./ui/sections/select-dataset-drawer.tsx")).SelectDatasetDrawer,
      }),
    },
  });
