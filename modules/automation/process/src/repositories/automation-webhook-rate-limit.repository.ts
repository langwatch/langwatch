import { WebhookDispatchRateLimiter } from "@langwatch/egress";

/** The webhook dispatch budget an automation's deliveries count against. */
export abstract class AutomationWebhookRateLimitRepository extends WebhookDispatchRateLimiter {}
