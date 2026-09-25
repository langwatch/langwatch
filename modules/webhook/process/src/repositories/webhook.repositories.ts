import type { ProcessStore } from "@langwatch/eventing";

import type { WebhookEndpointRepository } from "./webhook-endpoint.repository.ts";
import type { WebhookEventsRepository } from "./webhook-events.repository.ts";
import type { WebhookRetentionRepository } from "./webhook-retention.repository.ts";
import type { WebhookTenantsRepository } from "./webhook-tenants.repository.ts";

export interface WebhookRepositories {
  readonly endpoints: WebhookEndpointRepository;
  readonly events: WebhookEventsRepository;
  readonly retention: WebhookRetentionRepository;
  readonly tenants: WebhookTenantsRepository;
  /** Shared with the worker's delivery process manager: health and replay read it. */
  readonly processStore: ProcessStore;
}
