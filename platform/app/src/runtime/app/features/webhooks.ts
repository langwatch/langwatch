import type { ProcessManagerApplier } from "@langwatch/eventing";
import {
  WebhookDeliveryService,
  WebhookEndpointAdapter,
  WebhookEndpointPolicyService,
  WebhookAccessService,
  WebhookEnvelopeService,
  type DeliverPayload,
  type GatewaySpendProcessingEvent,
  type LegacyWebhookEventsServiceOptions,
  type WebhookDeliveryProcessDeps,
  type WebhookEndpointRuntime,
  type WebhookEndpointServiceOptions,
  type WebhookSpendEventRow,
} from "@langwatch/enterprise-webhook-server";
import type { EntitlementService } from "@langwatch/entitlement-contract";

export * from "@langwatch/enterprise-webhook-server";

export class AppWebhookAccessRuntime {
  private static service: WebhookAccessService | undefined;

  static install(entitlements: EntitlementService): void {
    AppWebhookAccessRuntime.service = WebhookAccessService.create(entitlements);
  }

  static clear(): void {
    AppWebhookAccessRuntime.service = undefined;
  }

  static async assertEntitled(organizationId: string): Promise<void> {
    if (!AppWebhookAccessRuntime.service) {
      throw new Error("AppWebhookEntitlementRuntime has not been installed");
    }
    await AppWebhookAccessRuntime.service.assertEndpointsAvailable(organizationId);
  }
}

export const assertWebhookEndpointsEntitled = (organizationId: string): Promise<void> =>
  AppWebhookAccessRuntime.assertEntitled(organizationId);

export const createWebhookEndpointService = (
  options: WebhookEndpointServiceOptions,
): WebhookEndpointRuntime => WebhookEndpointAdapter.create(options);

export const spendRowToEnvelope = (row: WebhookSpendEventRow) =>
  WebhookEnvelopeService.fromSpendRow(row);

export const webhookRetryDelayMs = (input: { attempt: number }): number =>
  WebhookDeliveryService.retryDelayMs(input);

export const deliverPayloadToRow = (payload: DeliverPayload) =>
  WebhookDeliveryService.payloadToRow(payload);

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
  controls: Parameters<WebhookEndpointPolicyService["assertValidDeliveryControls"]>[0],
): void => WebhookEndpointPolicyService.create().assertValidDeliveryControls(controls);

export const describeDestination = (
  endpoint: Parameters<WebhookEndpointPolicyService["describeDestination"]>[0],
): string => WebhookEndpointPolicyService.create().describeDestination(endpoint);

export type { LegacyWebhookEventsServiceOptions };
