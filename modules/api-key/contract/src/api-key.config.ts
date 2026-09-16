import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The HMAC key an API key is hashed with, verbatim — a separate leaf from
 * the stored-secret cipher key so the pepper can rotate without
 * re-encrypting every credential. Blank still authenticates; not a refusal.
 */
export const apiKeyServerConfigDefinition = RuntimeConfig.define({
  pepper: Config.value(z.string().optional(), { env: "API_KEY_PEPPER" }),
});

export type ApiKeyServerConfig = ConfigValue<typeof apiKeyServerConfigDefinition>;

export const apiKeyServerConfigSchema = compileRuntimeConfig(apiKeyServerConfigDefinition);
