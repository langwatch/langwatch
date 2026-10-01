/**
 * What a browser installs when it installs dataset: the datasets list and
 * the dataset editor.
 */

import { SelectDatasetDrawerToken, UploadCsvDrawerToken } from "@langwatch/dataset-contract";
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
      requires: "datasets:view",
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
  })
  .drawer(SelectDatasetDrawerToken, {
    load: async () => ({
      default: (await import("./ui/sections/select-dataset-drawer.tsx")).SelectDatasetDrawer,
    }),
  })
  .drawer(UploadCsvDrawerToken, {
    load: async () => ({
      default: (await import("./ui/sections/datasets/routed-upload-csv-drawer.tsx"))
        .RoutedUploadCsvDrawer,
    }),
  })
  /** The create-or-edit drawer, editor table, picker list and record sync, lent (§3.4 rule 7). */
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
    datasetPickerList: {
      load: async () => ({
        default: (await import("./ui/sections/dataset-picker-list.tsx")).DatasetPickerList,
      }),
    },
    datasetRecordSync: {
      load: async () => ({
        default: (await import("./ui/sections/datasets/lent-dataset-record-sync.tsx"))
          .LentDatasetRecordSync,
      }),
    },
  });
