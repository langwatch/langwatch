import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Monitor's settings: only the shared deployment origin its platform links are built on. */
export const monitorConfig = Config.define(() => ({
  publicBaseUrl,
}));

export type MonitorServerConfig = ConfigOf<typeof monitorConfig>;
