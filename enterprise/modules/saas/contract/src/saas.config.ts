import {
  Config,
  compileRuntimeConfig,
  environmentOneOrTrueSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * Which product this deployment is, and who operates it.
 *
 * `isSaas` reads `1` or a case-insensitive `true` and nothing else, which is
 * the reading every tier already applies: three processes deriving one fact
 * from one variable must agree, or a hosted install's billable events go
 * uncounted with no error anywhere.
 *
 * `adminEmails` unset means NOBODY is a platform operator. That is the
 * fail-closed answer every surface must reach, so absence is stated here
 * rather than left for each caller to decide.
 */
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
