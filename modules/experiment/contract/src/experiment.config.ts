import { allowedProxyHosts, blockLocalHttpCalls, Config, type ConfigOf } from "@langwatch/config";

/** The address fence a run reads a dataset row's attachment link behind. Shared leaves. */
export const experimentConfig = Config.define(() => ({
  blockLocalHttpCalls,
  allowedProxyHosts,
}));

export type ExperimentServerConfig = ConfigOf<typeof experimentConfig>;
