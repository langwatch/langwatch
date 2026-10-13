import { Config, type ConfigOf, publicBaseUrl } from "@langwatch/config";

/** Prompt's settings: only the shared deployment origin its platform deep links are built on. */
export const promptConfig = Config.define(() => ({
  publicBaseUrl,
}));

export type PromptServerConfig = ConfigOf<typeof promptConfig>;
