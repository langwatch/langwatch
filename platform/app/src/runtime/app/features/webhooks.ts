import type { ProcessManagerApplier } from "@langwatch/eventing";
import {
  WebhookDeliveryService,
  WebhookEndpointAdapter,
  WebhookEndpointPolicyService,
  WebhookEntitlementAdapter,
  WebhookEnvelopeService,
  WebhookEventsClickHouseRepository,
  type DeliverPayload,
  type GatewaySpendProcessingEvent,
  type LegacyWebhookEventsServiceOptions,
  type WebhookDeliveryProcessDeps,
  type WebhookEndpointRuntime,
  type WebhookEndpointServiceOptions,
  type WebhookEntitlementService,
  type WebhookEventsCursor,
  type WebhookSpendEventRow,
} from "@langwatch/enterprise-webhooks-server";

export * from "@langwatch/enterprise-webhooks-server";

export class AppWebhookEntitlementRuntime {
  private static adapter: WebhookEntitlementAdapter | undefined;

  static install(service: WebhookEntitlementService): void {
    AppWebhookEntitlementRuntime.adapter = WebhookEntitlementAdapter.create(service);
  }

  static clear(): void {
    AppWebhookEntitlementRuntime.adapter = undefined;
  }

  static async assertEntitled(organizationId: string): Promise<void> {
    if (!AppWebhookEntitlementRuntime.adapter) {
      throw new Error("AppWebhookEntitlementRuntime has not been installed");
    }
    await AppWebhookEntitlementRuntime.adapter.assertEntitled(organizationId);
  }
}

export const assertWebhookEndpointsEntitled = (
  organizationId: string,
): Promise<void> => AppWebhookEntitlementRuntime.assertEntitled(organizationId);

export const createWebhookEndpointService = (
  options: WebhookEndpointServiceOptions,
): WebhookEndpointRuntime => WebhookEndpointAdapter.create(options);

export const spendRowToEnvelope = (row: WebhookSpendEventRow) =>
  WebhookEnvelopeService.fromSpendRow(row);

export const webhookRetryDelayMs = (input: { attempt: number }): number =>
  WebhookDeliveryService.retryDelayMs(input);

export const isEndpointStreamKey = (processKey: string): boolean =>
  WebhookDeliveryService.isEndpointStreamKey(processKey);

export const deliverPayloadToRow = (payload: DeliverPayload) =>
  WebhookDeliveryService.payloadToRow(payload);

export const appendReplayToEndpointStream = (
  input: Parameters<typeof WebhookDeliveryService.appendReplayToEndpointStream>[0],
): Promise<void> => WebhookDeliveryService.appendReplayToEndpointStream(input);

export const runDeliver = (deps: WebhookDeliveryProcessDeps) =>
  WebhookDeliveryService.create(deps).runDeliver();

export const runFlushEndpoint = (deps: WebhookDeliveryProcessDeps) =>
  WebhookDeliveryService.create(deps).runFlushEndpoint();

export const runWebhookSendBatch = (deps: WebhookDeliveryProcessDeps) =>
  WebhookDeliveryService.create(deps).runWebhookSendBatch();

export const webhookDeliveryPM = (
  deps: WebhookDeliveryProcessDeps,
): ProcessManagerApplier<GatewaySpendProcessingEvent> =>
  WebhookDeliveryService.create(deps).processManager();

export const assertValidDeliveryControls = (
  controls: Parameters<
    WebhookEndpointPolicyService["assertValidDeliveryControls"]
  >[0],
): void =>
  WebhookEndpointPolicyService.create().assertValidDeliveryControls(controls);

export const describeDestination = (
  endpoint: Parameters<WebhookEndpointPolicyService["describeDestination"]>[0],
): string => WebhookEndpointPolicyService.create().describeDestination(endpoint);

export const encodeWebhookEventsCursor = (cursor: WebhookEventsCursor): string =>
  WebhookEventsClickHouseRepository.encodeCursor(cursor);

export const decodeWebhookEventsCursor = (encoded: string) =>
  WebhookEventsClickHouseRepository.decodeCursor(encoded);

export const parseWebhookEventId = (id: string) =>
  WebhookEventsClickHouseRepository.parseEventId(id);

export type { LegacyWebhookEventsServiceOptions };
