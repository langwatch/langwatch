/** Datasets family with two screens. Frontend mounts tRPC Provider and host
 * port (project/grants/replication/addresses).
 */

import type { ComponentType } from "react";

export type DatasetScreenLoader = () => Promise<{ default: ComponentType }>;

export const datasetScreens = {
  datasets: () => import("./ui/sections/datasets.screen.tsx"),
  datasetEditor: () => import("./ui/sections/dataset-editor.screen.tsx"),
} as const satisfies Record<string, DatasetScreenLoader>;

export type DatasetScreenName = keyof typeof datasetScreens;

export { datasetApi } from "./behavior/dataset-api.ts";
export {
  DatasetHostApi,
  DatasetHostProvider,
  type DatasetCopyTarget,
  type DatasetFailureNotice,
  type DatasetHostProject,
  type DatasetRouteReading,
  type DatasetSuccessNotice,
} from "./model/dataset-host.ts";
