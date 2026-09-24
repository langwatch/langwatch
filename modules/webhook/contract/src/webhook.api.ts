import { moduleApi } from "@langwatch/kernel/module-api";

import type { WebhookSpendDeliveryRequest } from "./webhook-spend-delivery.ts";
import type {
  CreateWebhookEndpointCommand,
  UpdateWebhookEndpointCommand,
} from "./webhook.commands.ts";
import type { ListWebhookEventsQuery, ListWebhookEventsResult } from "./webhook.queries.ts";
import type {
  WebhookDeliveryLog,
  WebhookDeliveryPosition,
  WebhookEndpointHealth,
  WebhookEndpointView,
  WebhookEnvelope,
  WebhookTestFireResult,
} from "./webhook.ts";

export interface WebhookApi {
  create(
    input: CreateWebhookEndpointCommand,
  ): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
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
  findDeliverable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView | null>;
  /** One endpoint's delivery log, newest first, one page at a time. */
  getDeliveries(input: {
    organizationId: string;
    endpointId: string;
    limit?: number;
    cursor?: WebhookDeliveryPosition;
  }): Promise<WebhookDeliveryLog>;
  getHealth(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointHealth>;
  /** Sends a signed test event through the exact hop a real delivery dispatches
   *  through, and records the attempt in the endpoint's delivery log. */
  testFire(input: { organizationId: string; endpointId: string }): Promise<WebhookTestFireResult>;
  getEmittedEvents(input: ListWebhookEventsQuery): Promise<ListWebhookEventsResult>;
  findEmittedEventById(input: {
    organizationId: string;
    id: string;
  }): Promise<WebhookEnvelope | null>;
  assertEndpointsEntitled(organizationId: string): Promise<void>;
  /** Re-delivers one already-emitted envelope through the endpoint's normal delivery path. */
  appendReplayToEndpointStream(input: {
    organizationId: string;
    endpoint: { id: string; enabledEvents: readonly string[] };
    envelope: WebhookEnvelope;
    replayId: string;
  }): Promise<void>;
  /** Queues one committed gateway spend event for delivery; a repeat of it is dropped. */
  requestSpendDelivery(input: WebhookSpendDeliveryRequest): Promise<void>;
}

export const WebhookApi = moduleApi<WebhookApi>()("webhook");
