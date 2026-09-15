import {
  Config,
  compileRuntimeConfig,
  environmentBooleanSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * How a directory's deprovisioning reaches this deployment.
 *
 * A blank webhook secret answers 404 rather than 401, so an unconfigured
 * install looks unrouted rather than merely unauthorised. `provenOffboarding`
 * is a CONSTRUCTION input, not a per-tenant flag: one offboarding path per
 * process, chosen at boot.
 */
export const scimServerConfigDefinition = RuntimeConfig.define({
  auth0WebhookSecret: Config.value(z.string().optional(), { env: "AUTH0_SCIM_WEBHOOK_SECRET" }),
  provenOffboarding: Config.value(environmentBooleanSchema.default(false), {
    env: "SCIM_V2_GRANTS",
  }),
});

export type ScimServerConfig = ConfigValue<typeof scimServerConfigDefinition>;

export const scimServerConfigSchema = compileRuntimeConfig(scimServerConfigDefinition);
