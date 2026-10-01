import { moduleApi } from "@langwatch/kernel/module-api";

import type { WebhookGatewayEventDeliveryRequest } from "./webhook-governance-delivery.ts";
import type {
  WebhookRequestDelivery,
  WebhookRequestSource,
  WebhookSendRequest,
  WebhookSendRequestResult,
} from "./webhook-request.ts";
import type {
  ApplyWebhookEndpointChangesCommand,
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
  /** Updates whatever fields were named, then moves the status when one was asked for. */
  applyEndpointChanges(input: ApplyWebhookEndpointChangesCommand): Promise<WebhookEndpointView>;
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
  /** Throws `WebhookEventNotFoundError` when the log cannot answer for the id. */
  getEmittedEventById(input: { organizationId: string; id: string }): Promise<WebhookEnvelope>;
  assertEndpointsEntitled(organizationId: string): Promise<void>;
  /** Re-delivers one already-emitted envelope through the endpoint's normal delivery path. */
  appendReplayToEndpointStream(input: {
    organizationId: string;
    endpoint: { id: string; enabledEvents: readonly string[] };
    envelope: WebhookEnvelope;
    replayId: string;
  }): Promise<void>;
  /** Queues one committed gateway event (spend or governance) for delivery; a repeat is dropped. */
  requestGatewayEventDelivery(input: WebhookGatewayEventDeliveryRequest): Promise<void>;
  /** Sends one attempt and logs it; throws a classified `DispatchError` for the outbox. */
  sendRequest(input: WebhookSendRequest): Promise<WebhookSendRequestResult>;
  /** One source's recorded {@link sendRequest} attempts, newest first. */
  findDeliveriesBySource(input: {
    projectId: string;
    source: WebhookRequestSource;
    limit: number;
  }): Promise<WebhookRequestDelivery[]>;
}

export const WebhookApi = moduleApi<WebhookApi>()("webhook");
