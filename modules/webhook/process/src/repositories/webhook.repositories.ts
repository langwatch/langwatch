import type { WebhookDispatchCapRepository } from "./webhook-dispatch-cap.repository.ts";
import type { WebhookEndpointRepository } from "./webhook-endpoint.repository.ts";
import type { WebhookEventsRepository } from "./webhook-events.repository.ts";
import type { WebhookRateLimitRepository } from "./webhook-rate-limit.repository.ts";
import type { WebhookRetentionRepository } from "./webhook-retention.repository.ts";

export interface WebhookRepositories {
  readonly dispatchCaps: WebhookDispatchCapRepository;
  readonly endpoints: WebhookEndpointRepository;
  readonly events: WebhookEventsRepository;
  /** The test-fire door's per-organization window. */
  readonly rateLimits: WebhookRateLimitRepository;
  readonly retention: WebhookRetentionRepository;
}
