import {
  Config,
  type ConfigOf,
  environmentOneOrTrueSchema,
  publicBaseUrl,
} from "@langwatch/config";
import { z } from "zod";

/** Dataset's settings: the deployment origin, and where single-file datasets were kept. */
export const datasetConfig = Config.define((c) => ({
  publicBaseUrl,
  /** Read only by the content move, which copies those files into today's chunks. */
  singleFileStorage: {
    onLocalDisk: c.env("DATASET_STORAGE_LOCAL", environmentOneOrTrueSchema),
    localPath: c.env("LOCAL_STORAGE_PATH", z.string().optional()),
  },
}));

export type DatasetServerConfig = ConfigOf<typeof datasetConfig>;
