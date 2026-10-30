import {
  Config,
  type ConfigOf,
  environmentOneOrTrueSchema,
  publicBaseUrl,
} from "@langwatch/config";
import { z } from "zod";

/** Dataset's settings: the deployment origin, and where single-file datasets are kept. */
export const datasetConfig = Config.define((c) => ({
  publicBaseUrl,
  /** The previous release's single-file datasets (`useS3`), still read and written in place. */
  singleFileStorage: {
    onLocalDisk: c.env("DATASET_STORAGE_LOCAL", environmentOneOrTrueSchema),
    localPath: c.env("LOCAL_STORAGE_PATH", z.string().optional()),
  },
}));

export type DatasetServerConfig = ConfigOf<typeof datasetConfig>;
