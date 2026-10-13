import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Dataset's settings: only the shared deployment origin its platform links are built on. */
export const datasetConfig = Config.define(() => ({
  publicBaseUrl,
}));

export type DatasetServerConfig = ConfigOf<typeof datasetConfig>;
