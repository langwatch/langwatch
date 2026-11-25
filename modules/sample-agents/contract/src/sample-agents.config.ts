import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Sample agents' settings: only the shared deployment origin its trace collector posts to. */
export const sampleAgentsConfig = Config.define(() => ({
  publicBaseUrl,
}));

export type SampleAgentsServerConfig = ConfigOf<typeof sampleAgentsConfig>;
