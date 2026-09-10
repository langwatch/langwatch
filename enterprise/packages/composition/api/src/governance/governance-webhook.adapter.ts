// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { eventMatches } from "@langwatch/webhook-contract";
import {
  WebhookDeliveryService,
  WEBHOOK_SEND_MAX_ATTEMPTS,
  type WebhookDeliveryProcessDeps,
} from "@langwatch/webhook-server";
import {
  GovernanceEventDeliveryProcess,
  GovernanceWebhook,
  type GovernanceWebhookSendBatch,
} from "@langwatch/enterprise-governance-server";
import type { IntentContext } from "@langwatch/eventing";

type WebhookSendBatch = (
  payload: GovernanceWebhookSendBatch,
  context: IntentContext,
) => Promise<void>;

export class AppGovernanceWebhook extends GovernanceWebhook {
  readonly maxAttempts = WEBHOOK_SEND_MAX_ATTEMPTS;

  private constructor(
    private readonly dependencies: WebhookDeliveryProcessDeps,
    private readonly send: WebhookSendBatch,
  ) {
    super();
  }

  static create(dependencies: WebhookDeliveryProcessDeps): AppGovernanceWebhook {
    return new AppGovernanceWebhook(
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

  async activeEndpointIds(input: { organizationId: string; eventType: string }): Promise<string[]> {
    const endpoints = await this.dependencies.endpoints.getActiveByOrganization({
      organizationId: input.organizationId,
    });
    return endpoints
      .filter((endpoint) => eventMatches(endpoint.enabledEvents, input.eventType))
      .map(({ id }) => id);
  }

  sendBatch(payload: GovernanceWebhookSendBatch, context: IntentContext): Promise<void> {
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
  private constructor(private readonly dependencies: WebhookDeliveryProcessDeps) {}

  static create(dependencies: WebhookDeliveryProcessDeps): AppGovernanceWebhookAdapter {
    return new AppGovernanceWebhookAdapter(dependencies);
  }

  build(): GovernanceEventDeliveryProcess {
    return GovernanceEventDeliveryProcess.create(
      AppGovernanceWebhook.create(this.dependencies),
    );
  }
}
