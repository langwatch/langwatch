import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Staff access's settings: the deployment origin approval links are built on. */
export const staffAccessConfig = Config.define(() => ({
  publicBaseUrl,
}));

export type StaffAccessServerConfig = ConfigOf<typeof staffAccessConfig>;
