import { Config, isSaas, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/** What a browser is told: which product it is looking at. */
export const saasWebConfigSchema = z.strictObject({
  deployment: z.enum(["saas", "self-hosted"]),
});

export type SaasWebConfig = z.infer<typeof saasWebConfigSchema>;

/** Whether this deployment is LangWatch Cloud: the shared `isSaas` leaf, one claim among many. */
export const saasConfig = Config.define(() => ({ isSaas }));

export type SaasServerConfig = ConfigOf<typeof saasConfig>;
