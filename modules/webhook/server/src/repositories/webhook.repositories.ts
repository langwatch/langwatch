import type { WebhookEventsRepository } from "./webhook-events.repository.ts";
import type { WebhookEndpointRuntime } from "./webhook-endpoint.repository.ts";
import type { WebhookRetentionRepository } from "./webhook-retention.repository.ts";
import type { WebhookTenantsRepository } from "./webhook-tenants.repository.ts";

/**
 * The rows the webhook module owns, chosen once at boot. Postgres holds the
 * endpoint registry and the retention rows; ClickHouse holds the emitted
 * event envelopes `events` reads. Both stores back the one "postgres" tier -
 * it names the tier, not either store alone - so a process on that tier
 * always gets all four.
 */
export interface WebhookRepositories {
  readonly endpoints: WebhookEndpointRuntime;
  readonly events: WebhookEventsRepository;
  readonly retention: WebhookRetentionRepository;
  readonly tenants: WebhookTenantsRepository;
}
