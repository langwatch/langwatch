import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Webhook destination fences; opt in with literal '1', refuse other values.
 */
const unsafeSwitch = z
  .union([z.boolean(), z.literal("1"), z.literal("0"), z.literal("")])
  .optional()
  .transform((value) => value === true || value === "1");

export const webhookConfig = Config.define((c) => ({
  allowInsecureLocalUrls: c.env("WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS", unsafeSwitch),
  allowAmbientAwsCredentials: c.env("WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS", unsafeSwitch),
}));

export type WebhookServerConfig = ConfigOf<typeof webhookConfig>;
