import { createWebhookSender } from "@langwatch/automations-server/clients/http/webhook.client";
import { rateLimit } from "~/server/rateLimit";
import { createSSRFValidator } from "~/utils/ssrfProtection";
import { appHttpEgress } from "./appHttpEgress";

/**
 * The webhook channel's SSRF policy (ADR-040 §4): private-IP / localhost
 * blocking is FORCED ON regardless of the global BLOCK_LOCAL_HTTP_CALLS
 * toggle — a customer-supplied URL fired from our workers must never reach
 * `10.x` / `localhost`, even in deployments that relax the toggle for their
 * own internal integrations.
 */
const validateWebhookUrl = createSSRFValidator({
  blockLocal: true,
  allowedHosts: [],
});

/** The app-configured webhook sender (ADR-063 §1). */
export const { sendWebhook } = createWebhookSender({
  egress: appHttpEgress,
  rateLimit,
  validateWebhookUrl,
});
