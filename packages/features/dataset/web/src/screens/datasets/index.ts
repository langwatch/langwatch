/**
 * The Datasets family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes for each
 * page is a LOADER rather than a component, because between them the two screens
 * drag four overlays, a spreadsheet grid and a CSV parser behind them, and none
 * of that belongs in the chunk that renders the rest of the application.
 *
 * TWO SCREENS, TWO ADDRESSES: `/:project/datasets` and
 * `/:project/datasets/:id`.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider this package's hooks run on, and the host port that answers for the
 * project, the reader's grants and membership, the replication targets, the
 * address and the two notices.
 */

import type { ComponentType } from "react";

export type DatasetScreenLoader = () => Promise<{ default: ComponentType }>;

export const datasetScreens = {
  datasets: () => import("./datasets.screen"),
  datasetEditor: () => import("./dataset-editor.screen"),
} as const satisfies Record<string, DatasetScreenLoader>;

export type DatasetScreenName = keyof typeof datasetScreens;

export { datasetApi } from "../../behavior/dataset-api";
export {
  DatasetHostPort,
  DatasetHostProvider,
  type DatasetCopyTarget,
  type DatasetFailureNotice,
  type DatasetHostProject,
  type DatasetRouteReading,
  type DatasetSuccessNotice,
} from "../../model/dataset-host";
