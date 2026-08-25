import type {
  CreateWebhookEndpointCommand,
  UpdateWebhookEndpointCommand,
} from "./webhook.commands";
import type { ListWebhookEventsQuery, ListWebhookEventsResult } from "./webhook.queries";
import type { WebhookEndpointHealth, WebhookEndpointView } from "./webhook";

export abstract class WebhookEndpointService {
  abstract create(
    command: CreateWebhookEndpointCommand,
  ): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
  abstract getAll(input: { organizationId: string }): Promise<WebhookEndpointView[]>;
  abstract getById(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView>;
  abstract update(command: UpdateWebhookEndpointCommand): Promise<WebhookEndpointView>;
  abstract enable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView>;
  abstract disable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView>;
  abstract archive(input: { organizationId: string; endpointId: string }): Promise<void>;
}

export abstract class WebhookEventsService {
  abstract tryGetEmittedEventById(input: {
    organizationId: string;
    id: string;
  }): Promise<import("./webhook").WebhookEnvelope | null>;
  abstract getEmittedEvents(
    query: ListWebhookEventsQuery,
  ): Promise<ListWebhookEventsResult>;
}

export abstract class WebhookHealthService {
  abstract health(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointHealth>;
}
