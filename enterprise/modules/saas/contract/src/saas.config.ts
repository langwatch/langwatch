import { Config, isSaas, type ConfigOf } from "@langwatch/config";

/** Whether this deployment is LangWatch Cloud: the shared `isSaas` leaf, one claim among many. */
export const saasConfig = Config.define(() => ({ isSaas }));

export type SaasServerConfig = ConfigOf<typeof saasConfig>;
