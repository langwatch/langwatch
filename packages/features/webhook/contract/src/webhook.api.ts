import { featureApi } from "@langwatch/runtime-composition";
import type {
  CreateWebhookEndpointCommand,
  UpdateWebhookEndpointCommand,
} from "./webhook.commands.ts";
import type { ListWebhookEventsQuery, ListWebhookEventsResult } from "./webhook.queries.ts";
import type {
  WebhookEndpointHealth,
  WebhookEndpointView,
  WebhookEnvelope,
} from "./webhook.ts";

/**
 * The outbound webhook capability installed into a process.
 *
 * Endpoint persistence, delivery stores and transport adapters stay behind
 * this callable boundary. A caller receives one installed application, never
 * a repository or one of the feature's internal services.
 */
export interface WebhookApi {
  create(input: CreateWebhookEndpointCommand): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
  getAll(input: { organizationId: string }): Promise<WebhookEndpointView[]>;
  getById(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  update(input: UpdateWebhookEndpointCommand): Promise<WebhookEndpointView>;
  rollSecret(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
  enable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  disable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  archive(input: { organizationId: string; endpointId: string }): Promise<void>;
  tryGetDeliverable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView | null>;
  getHealth(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointHealth>;
  getEmittedEvents(input: ListWebhookEventsQuery): Promise<ListWebhookEventsResult>;
  tryGetEmittedEventById(input: {
    organizationId: string;
    id: string;
  }): Promise<WebhookEnvelope | null>;
  assertEndpointsEntitled(organizationId: string): Promise<void>;
}

export const WebhookApi = featureApi<WebhookApi>("webhook");
