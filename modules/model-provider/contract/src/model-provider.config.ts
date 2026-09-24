import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  langwatchDefaultModel,
  type ConfigOf,
} from "@langwatch/config";

/**
 * The address fence an outbound provider call is judged by, and the terminal
 * default model. Shared deployment-fact leaves: scenario reads the same ones.
 */
export const modelProviderConfig = Config.define(() => ({
  blockLocalHttpCalls,
  allowedProxyHosts,
  defaultModel: langwatchDefaultModel,
}));

export type ModelProviderServerConfig = ConfigOf<typeof modelProviderConfig>;
