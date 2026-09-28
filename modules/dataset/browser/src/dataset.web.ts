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
    addOrEditDataset: {
      load: async () => ({
        default: (await import("./ui/sections/datasets/lent-add-or-edit-dataset-drawer.tsx"))
          .LentAddOrEditDatasetDrawer,
      }),
    },
    selectDataset: {
      load: async () => ({
        default: (await import("./ui/sections/select-dataset-drawer.tsx")).SelectDatasetDrawer,
      }),
    },
  })
  /** The create-or-edit drawer, the record sync and the editor table, lent (§3.4 rule 7). */
  .withCapabilities({
    addOrEditDatasetDrawer: {
      load: async () => ({
        default: (await import("./ui/sections/datasets/lent-add-or-edit-dataset-drawer.tsx"))
          .LentAddOrEditDatasetDrawer,
      }),
    },
    datasetEditorTable: {
      load: async () => ({
        default: (await import("./ui/sections/datasets/lent-dataset-editor-table.tsx"))
          .LentDatasetEditorTable,
      }),
    },
    datasetRecordSync: {
      load: async () => ({
        default: (await import("./ui/sections/datasets/lent-dataset-record-sync.tsx"))
          .LentDatasetRecordSync,
      }),
    },
  });
