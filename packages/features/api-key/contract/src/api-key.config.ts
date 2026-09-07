import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The HMAC key an API key is hashed with, verbatim.
 *
 * A separate leaf from the stored-secret cipher key even though the two share
 * a fallback chain, so the pepper can rotate without re-encrypting every
 * stored credential. Blank is not a refusal: a key hashed with no pepper still
 * authenticates, and the shape is the hasher's own rule to enforce.
 */
export const apiKeyServerConfigDefinition = RuntimeConfig.define({
  pepper: Config.value(z.string().optional(), { env: "API_KEY_PEPPER" }),
});

export type ApiKeyServerConfig = ConfigValue<typeof apiKeyServerConfigDefinition>;

export const apiKeyServerConfigSchema = compileRuntimeConfig(apiKeyServerConfigDefinition);
