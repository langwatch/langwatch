import {
  allowInsecureLocalUrls,
  Config,
  isSaas,
  outboundProxy,
  type ConfigOf,
} from "@langwatch/config";
import { z } from "zod";

const unsafeSwitch = z
  .union([z.boolean(), z.literal("1"), z.literal("0"), z.literal("")])
  .optional()
  .transform((value) => value === true || value === "1");

export const webhookConfig = Config.define((c) => ({
  /** The dev switch (the shared leaf); automation honours the same one. */
  allowInsecureLocalUrls,
  allowAmbientAwsCredentials: c.env("WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS", unsafeSwitch),
  /** The hosted product (the shared leaf): its HTTP egress verifies the receiver's certificate. */
  isSaas,
  /** The proxy spellings (the shared leaf); SQS deliveries follow them. */
  outboundProxy,
}));

export type WebhookServerConfig = ConfigOf<typeof webhookConfig>;
