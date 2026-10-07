import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** The deployment facts user reads: the shared origin a budget-increase mail links back to. */
export const userConfig = Config.define(() => ({
  /** The shared deployment origin; absent, a budget-increase request is refused by name. */
  publicBaseUrl,
}));

export type UserServerConfig = ConfigOf<typeof userConfig>;
