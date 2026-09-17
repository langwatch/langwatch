import {
  Config,
  compileRuntimeConfig,
  environmentBooleanSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * A blank webhook secret answers 404 so an unconfigured install looks unrouted.
 * `provenOffboarding` selects one process-wide offboarding path at boot.
 */
export const scimServerConfigDefinition = RuntimeConfig.define({
  auth0WebhookSecret: Config.value(z.string().optional(), { env: "AUTH0_SCIM_WEBHOOK_SECRET" }),
  provenOffboarding: Config.value(environmentBooleanSchema.default(false), {
    env: "SCIM_V2_GRANTS",
  }),
});

export type ScimServerConfig = ConfigValue<typeof scimServerConfigDefinition>;

export const scimServerConfigSchema = compileRuntimeConfig(scimServerConfigDefinition);
