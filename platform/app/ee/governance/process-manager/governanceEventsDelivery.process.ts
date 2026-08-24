// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { eventMatches } from "@langwatch/enterprise-webhooks-contract";
import {
  WebhookDeliveryService,
  WEBHOOK_SEND_MAX_ATTEMPTS,
  type WebhookDeliveryProcessDeps,
} from "@langwatch/enterprise-webhooks-server";
import {
  GovernanceEventsDeliveryProcessService,
  GovernanceWebhookPort,
  GOVERNANCE_EVENTS_PROCESS_NAME,
  deliverGovernanceSchema,
  governanceSendBatchSchema,
  type DeliverGovernancePayload,
  type GovernanceWebhookSendBatch,
} from "@langwatch/enterprise-governance-server";
import type { IntentContext } from "@langwatch/eventing";

export { GOVERNANCE_EVENTS_PROCESS_NAME };
export { deliverGovernanceSchema, governanceSendBatchSchema };
export type { DeliverGovernancePayload };

class AppGovernanceWebhookPort extends GovernanceWebhookPort {
  readonly maxAttempts = WEBHOOK_SEND_MAX_ATTEMPTS;

  private constructor(
    private readonly deps: WebhookDeliveryProcessDeps,
    private readonly send: ReturnType<
      WebhookDeliveryService["runWebhookSendBatch"]
    >,
  ) {
    super();
  }

  static create(deps: WebhookDeliveryProcessDeps): AppGovernanceWebhookPort {
    return new AppGovernanceWebhookPort(
      deps,
      WebhookDeliveryService.create(deps).runWebhookSendBatch(),
    );
  }

  get processStore() {
    return this.deps.processStore;
  }

  async webhooksEnabled(organizationId: string): Promise<boolean> {
    const plan = await this.deps.getPlan(organizationId);
    return plan.webhookEndpointsEnabled === true;
  }

  async activeEndpointIds(input: {
    organizationId: string;
    eventType: string;
  }): Promise<string[]> {
    const endpoints = await this.deps.endpoints.getActiveByOrganization({
      organizationId: input.organizationId,
    });
    return endpoints
      .filter((endpoint) =>
        eventMatches(endpoint.enabledEvents, input.eventType),
      )
      .map(({ id }) => id);
  }

  sendBatch(
    payload: GovernanceWebhookSendBatch,
    context: IntentContext,
  ): Promise<void> {
    return this.send(payload, context);
  }

  retryDelayMs(input: { attempt: number }): number {
    return WebhookDeliveryService.retryDelayMs(input);
  }

  now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

export class AppGovernanceEventsDeliveryRuntime {
  private constructor(
    private readonly service: GovernanceEventsDeliveryProcessService,
  ) {}

  static create(
    deps: WebhookDeliveryProcessDeps,
  ): AppGovernanceEventsDeliveryRuntime {
    return new AppGovernanceEventsDeliveryRuntime(
      GovernanceEventsDeliveryProcessService.create(
        AppGovernanceWebhookPort.create(deps),
      ),
    );
  }

  processManager() {
    return this.service.processManager();
  }

  deliver(
    payload: DeliverGovernancePayload,
    context: IntentContext,
  ): Promise<void> {
    return this.service.deliver(payload, context);
  }
}
