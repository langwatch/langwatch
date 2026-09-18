/**
 * What a browser installs when it installs dataset: the datasets list and
 * the dataset editor, and the surfaces prompt, workflow, experiment and
 * trace mount today.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const datasetWeb = defineWebModule("dataset")
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
  /**
   * What another module may mount. workflow and experiment open the
   * dataset drawers and editor table; prompt, trace and workflow preview
   * dataset rows through the two preview tables.
   */
  .publishSurfaces({
    "dataset-drawer": { load: () => import("./dataset-drawer.ts") },
    "dataset-picker-list": { load: () => import("./dataset-picker-list.ts") },
    "dataset-editor-table": { load: () => import("./dataset-editor-table.ts") },
    "dataset-record-sync": { load: () => import("./dataset-record-sync.ts") },
    "render-dataset-image": { load: () => import("./render-dataset-image.ts") },
    "upload-csv-drawer": { load: () => import("./upload-csv-drawer.ts") },
    "dataset-table": { load: () => import("./dataset-table.ts") },
    "dataset-preview-table": { load: () => import("./dataset-preview-table.ts") },
    "surfaces/dataset-image-preview-table": {
      load: () => import("./ui/blocks/datasets/editor/dataset-preview-table.tsx"),
    },
  });
