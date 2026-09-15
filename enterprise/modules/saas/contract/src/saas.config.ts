import {
  Config,
  compileRuntimeConfig,
  environmentOneOrTrueSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

// Which product this deployment is and who operates it; isSaas is strict (1 or true)
// so three processes deriving one fact must agree. Unset adminEmails means no operator.
export const saasServerConfigDefinition = RuntimeConfig.define({
  isSaas: Config.value(environmentOneOrTrueSchema, { env: "IS_SAAS" }),
  adminEmails: Config.value(z.string().optional(), { env: "ADMIN_EMAILS" }),
});

export type SaasServerConfig = ConfigValue<typeof saasServerConfigDefinition>;

export const saasServerConfigSchema = compileRuntimeConfig(saasServerConfigDefinition);

/** What a browser is told: which product it is looking at. */
export const saasWebConfigSchema = z.strictObject({
  deployment: z.enum(["saas", "self-hosted"]),
});

export type SaasWebConfig = z.infer<typeof saasWebConfigSchema>;
