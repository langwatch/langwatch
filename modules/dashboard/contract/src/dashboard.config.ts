import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Dashboard's settings: only the shared deployment origin its alert links are built on. */
export const dashboardConfig = Config.define(() => ({
  publicBaseUrl,
}));

export type DashboardServerConfig = ConfigOf<typeof dashboardConfig>;
