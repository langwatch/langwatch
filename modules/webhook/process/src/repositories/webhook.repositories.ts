import type { WebhookDispatchCapRepository } from "./webhook-dispatch-cap.repository.ts";
import type { WebhookEndpointRepository } from "./webhook-endpoint.repository.ts";
import type { WebhookEventsRepository } from "./webhook-events.repository.ts";
import type { WebhookRetentionRepository } from "./webhook-retention.repository.ts";
import type { WebhookTenantsRepository } from "./webhook-tenants.repository.ts";

export interface WebhookRepositories {
  readonly dispatchCaps: WebhookDispatchCapRepository;
  readonly endpoints: WebhookEndpointRepository;
  readonly events: WebhookEventsRepository;
  readonly retention: WebhookRetentionRepository;
  readonly tenants: WebhookTenantsRepository;
}
