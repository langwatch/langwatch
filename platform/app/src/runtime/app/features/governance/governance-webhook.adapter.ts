// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { eventMatches } from "@langwatch/enterprise-webhook-contract";
import {
  WebhookDeliveryService,
  WEBHOOK_SEND_MAX_ATTEMPTS,
  type WebhookDeliveryProcessDeps,
} from "@langwatch/enterprise-webhook-server";
import {
  GovernanceEventDeliveryProcess,
  GovernanceWebhookPort,
  type GovernanceWebhookSendBatch,
} from "@langwatch/enterprise-governance-server";
import type { IntentContext } from "@langwatch/eventing";

class AppGovernanceWebhookPort extends GovernanceWebhookPort {
  readonly maxAttempts = WEBHOOK_SEND_MAX_ATTEMPTS;

  private constructor(
    private readonly dependencies: WebhookDeliveryProcessDeps,
    private readonly send: ReturnType<
      WebhookDeliveryService["runWebhookSendBatch"]
    >,
  ) {
    super();
  }

  static create(
    dependencies: WebhookDeliveryProcessDeps,
  ): AppGovernanceWebhookPort {
    return new AppGovernanceWebhookPort(
      dependencies,
      WebhookDeliveryService.create(dependencies).runWebhookSendBatch(),
    );
  }

  get processStore() {
    return this.dependencies.processStore;
  }

  async webhooksEnabled(organizationId: string): Promise<boolean> {
    const plan = await this.dependencies.getPlan(organizationId);
    return plan.webhookEndpointsEnabled === true;
  }

  async activeEndpointIds(input: {
    organizationId: string;
    eventType: string;
  }): Promise<string[]> {
    const endpoints =
      await this.dependencies.endpoints.getActiveByOrganization({
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
    return (this.dependencies.now ?? Date.now)();
  }
}

export class AppGovernanceWebhookAdapter {
  private constructor(
    private readonly dependencies: WebhookDeliveryProcessDeps,
  ) {}

  static create(
    dependencies: WebhookDeliveryProcessDeps,
  ): AppGovernanceWebhookAdapter {
    return new AppGovernanceWebhookAdapter(dependencies);
  }

  build(): GovernanceEventDeliveryProcess {
    return GovernanceEventDeliveryProcess.create(
      AppGovernanceWebhookPort.create(this.dependencies),
    );
  }
}
