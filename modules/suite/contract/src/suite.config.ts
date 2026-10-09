import { Config, type ConfigOf, foldCacheTtlSeconds, publicBaseUrl } from "@langwatch/config";

/** Suite's settings: only the shared deployment origin its run plan links are built on. */
export const suiteConfig = Config.define(() => ({
  foldCacheTtlSeconds,
  publicBaseUrl,
}));

export type SuiteServerConfig = ConfigOf<typeof suiteConfig>;
