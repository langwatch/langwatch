import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Webhook destination fences; opt in with literal '1', refuse other values.
 */
const unsafeSwitch = z
  .union([z.boolean(), z.literal("1"), z.literal("0"), z.literal("")])
  .optional()
  .transform((value) => value === true || value === "1");

export const webhookServerConfigDefinition = RuntimeConfig.define({
  allowInsecureLocalUrls: Config.value(unsafeSwitch, {
    env: "WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS",
  }),
  allowAmbientAwsCredentials: Config.value(unsafeSwitch, {
    env: "WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS",
  }),
});

export type WebhookServerConfig = ConfigValue<typeof webhookServerConfigDefinition>;

export const webhookServerConfigSchema = compileRuntimeConfig(webhookServerConfigDefinition);
