# @langwatch/dataset-browser

The browser half of [dataset](../README.md). What a browser installs when it installs dataset: the datasets list and the dataset editor.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/dataset.web.ts:17` (`defineBrowserModule("dataset")`), exported as `datasetWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                        | URL                      | Within  | Label    | Permission      | Flags |
| ------------------------------- | ------------------------ | ------- | -------- | --------------- | ----- |
| `pages/[project]/datasets`      | `/:project/datasets`     | project | Datasets | `datasets:view` | –     |
| `pages/[project]/datasets/[id]` | `/:project/datasets/:id` | project | –        | –               | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer             | Opens                                                          | Opened from                             |
| ------------------ | -------------------------------------------------------------- | --------------------------------------- |
| `addOrEditDataset` | `src/ui/sections/datasets/lent-add-or-edit-dataset-drawer.tsx` | automation, navigation, trace, workflow |
| `selectDataset`    | `src/ui/sections/select-dataset-drawer.tsx`                    | experiment                              |
| `uploadCSV`        | `src/ui/sections/datasets/routed-upload-csv-drawer.tsx`        | experiment, workflow                    |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/dataset-client`.
- Lends: `DatasetEditorTableToken`, `AddOrEditDatasetDrawerToken`, `DatasetPickerListToken`, `DatasetRecordSyncToken`.
- Host APIs it requires: `DatasetHostApi`.

<!-- readme:generated:end -->
