import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The two fences a customer's webhook destination is judged by.
 *
 * Both opt in with the literal `1`, which is the reading both processes
 * already applied, and both refuse any other spelling. A deployment that
 * wrote `true` here has a closed fence and believes it is open; refusing at
 * boot tells the operator, where reading it as off tells nobody. Unset is
 * off, and off is the safe answer.
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
