import { Config, type ConfigOf, isSaas } from "@langwatch/config";

/** Usage's settings: only the shared leaf telling Cloud, which meters, from an install. */
export const usageConfig = Config.define(() => ({
  isSaas,
}));

export type UsageServerConfig = ConfigOf<typeof usageConfig>;
