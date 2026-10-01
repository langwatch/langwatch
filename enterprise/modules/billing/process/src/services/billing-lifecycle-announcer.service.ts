// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EventingCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { BillingLifecyclePipeline } from "../eventing/billing-lifecycle.pipeline.ts";
import { buildBillingLifecyclePipeline } from "../eventing/billing-lifecycle.pipeline.ts";

const logger = createLogger("langwatch:billing:lifecycle");

export type BillingLifecycleAnnouncerDeps = Readonly<{
  /** The webhook subscription repository, read only for whether a live subscription remains. */
  subscriptions: { findLastNonCancelled(organizationId: string): Promise<unknown> };
  /** The organization's members, read only for their ids. */
  organizations: {
    getAllMembers(input: { organizationId: string }): Promise<readonly Readonly<{ id: string }>[]>;
  };
}>;

/**
 * Records billing's own lifecycle facts on its pipeline: that an organization gained or lost its
 * subscription, and that a checkout completed. Never throws: a Stripe delivery is answered 200
 * whatever becomes of the record, as main's fire-and-forget hooks were.
 */
export class BillingLifecycleAnnouncerService {
  readonly pipeline: BillingLifecyclePipeline = buildBillingLifecyclePipeline();
  #commands: EventingCommands<BillingLifecyclePipeline> | undefined;

  static create(deps: BillingLifecycleAnnouncerDeps): BillingLifecycleAnnouncerService {
    return new BillingLifecycleAnnouncerService(deps);
  }

  private constructor(private readonly deps: BillingLifecycleAnnouncerDeps) {}

  /** Binds the lifecycle pipeline's own senders. */
  connect(commands: EventingCommands<BillingLifecyclePipeline>): void {
    this.#commands = commands;
  }

  subscriptionActivated(input: { organizationId: string }): Promise<void> {
    return this.#subscriptionChanged({ ...input, hasSubscription: () => Promise.resolve(true) });
  }

  /** Whether the organization still holds another live subscription is read after the cancel. */
  subscriptionCancelled(input: { organizationId: string }): Promise<void> {
    return this.#subscriptionChanged({
      ...input,
      hasSubscription: async () =>
        (await this.deps.subscriptions.findLastNonCancelled(input.organizationId)) != null,
    });
  }

  async checkoutCompleted(input: {
    organizationId: string;
    subscriptionId: string;
    checkoutCreatedAt: string;
  }): Promise<void> {
    await this.#record(input.organizationId, async (commands) => {
      await commands.recordCheckoutCompleted.send({
        tenantId: input.organizationId,
        occurredAt: nowInstant().epochMilliseconds,
        ...input,
      });
    });
  }

  async #subscriptionChanged(input: {
    organizationId: string;
    hasSubscription: () => Promise<boolean>;
  }): Promise<void> {
    await this.#record(input.organizationId, async (commands) => {
      const members = await this.deps.organizations.getAllMembers({
        organizationId: input.organizationId,
      });
      await commands.recordSubscriptionChanged.send({
        tenantId: input.organizationId,
        occurredAt: nowInstant().epochMilliseconds,
        organizationId: input.organizationId,
        memberUserIds: members.map((member) => member.id),
        hasSubscription: await input.hasSubscription(),
      });
    });
  }

  async #record(
    organizationId: string,
    send: (commands: EventingCommands<BillingLifecyclePipeline>) => Promise<void>,
  ): Promise<void> {
    try {
      if (!this.#commands) {
        throw new Error("billing_lifecycle pipeline senders are not connected yet");
      }
      await send(this.#commands);
    } catch (error) {
      logger.error({ error, organizationId }, "a billing lifecycle event was not recorded");
    }
  }
}
