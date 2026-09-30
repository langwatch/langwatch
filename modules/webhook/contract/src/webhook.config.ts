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
  /** The standard proxy spellings, keyed by env name; SQS deliveries follow them. */
  outboundProxy: {
    HTTPS_PROXY: c.env("HTTPS_PROXY", z.string().optional()),
    https_proxy: c.env("https_proxy", z.string().optional()),
    HTTP_PROXY: c.env("HTTP_PROXY", z.string().optional()),
    http_proxy: c.env("http_proxy", z.string().optional()),
    NO_PROXY: c.env("NO_PROXY", z.string().optional()),
    no_proxy: c.env("no_proxy", z.string().optional()),
  },
}));

export type WebhookServerConfig = ConfigOf<typeof webhookConfig>;
