import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Platform health's settings: only the shared deployment origin its report links are built on. */
export const platformHealthConfig = Config.define(() => ({ publicBaseUrl }));

export type PlatformHealthServerConfig = ConfigOf<typeof platformHealthConfig>;
