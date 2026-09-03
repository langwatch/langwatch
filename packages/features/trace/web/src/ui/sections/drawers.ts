/**
 * The URL-addressed drawers this family owns.
 *
 * ONE PUBLIC ENTRY FOR THE WHOLE SET, the shape `./screens/traces` keeps for
 * the pages: the composing application spreads a map of these into its drawer
 * registry, so what it may name is one entry rather than a path per component.
 *
 * `traceV2Details` IS NOT HERE, and that is not an omission. It is mounted
 * rather than registered — see `traceDrawerMount` on `./screens/traces` and the
 * module it loads.
 */

export {
  AddDatasetRecordDrawer,
  type AddDatasetRecordDrawerProps,
  type DatasetEditorComponent,
} from "./datasets/add-dataset-record-drawer";
