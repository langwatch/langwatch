// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EventingCommands } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";

import {
  buildBillingLifecyclePipeline,
  type BillingLifecyclePipeline,
  type BuildBillingLifecyclePipelineInput,
} from "../eventing/billing-lifecycle.pipeline.ts";
import type { BillingReportOrganizationRepository } from "../repositories/billing-report-organization.repository.ts";
import { usageBilledOf } from "../rules/usage-billed.rules.ts";

const logger = createLogger("langwatch:billing:lifecycle");

/** Attempts at a real usage-billing fact before billing logs it lost (ADR-174 decision 17). */
export const USAGE_BILLING_SEND_ATTEMPTS = 3;
const USAGE_BILLING_FIRST_PAUSE_MS = 200;

const pauseFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type BillingLifecycleAnnouncerDeps = Readonly<{
  /** The webhook subscription repository, read only for whether a live subscription remains. */
  subscriptions: { findLastNonCancelled(organizationId: string): Promise<unknown> };
  /** The organization's members, read only for their ids. */
  organizations: {
    getAllMembers(input: { organizationId: string }): Promise<readonly Readonly<{ id: string }>[]>;
  };
  /** The ops alert a peer's seat-limit event ends in, subscribed on the lifecycle pipeline. */
  resourceLimitAlerts: BuildBillingLifecyclePipelineInput["alerts"];
  /** The ops alert usage's limit-reached fact ends in, subscribed on the same pipeline. */
  planLimitAlerts: BuildBillingLifecyclePipelineInput["planLimitAlerts"];
  /** The meter's own read of an organization, uncached, for the usage-billing fact. */
  billingOrganizations: Pick<BillingReportOrganizationRepository, "getOrganizationForBilling">;
  /** The clock a usage-billing fact is stamped by; a test names its own. */
  now?: () => Instant;
  /** The wait between usage-billing attempts; a test names its own. */
  pause?: (ms: number) => Promise<void>;
  /** Where a lost usage-billing fact is logged; a test names its own. */
  logger?: Pick<Logger, "error">;
}>;

/**
 * Records billing's own lifecycle facts on its pipeline: that an organization gained or lost its
 * subscription, that a subscription became active, and that a checkout completed. Never throws: a Stripe delivery is answered 200
 * whatever becomes of the record, as main's fire-and-forget hooks were.
 */
export class BillingLifecycleAnnouncerService {
  readonly pipeline: BillingLifecyclePipeline;
  #commands: EventingCommands<BillingLifecyclePipeline> | undefined;

  static create(deps: BillingLifecycleAnnouncerDeps): BillingLifecycleAnnouncerService {
    return new BillingLifecycleAnnouncerService(deps);
  }

  private constructor(private readonly deps: BillingLifecycleAnnouncerDeps) {
    this.pipeline = buildBillingLifecyclePipeline({
      alerts: deps.resourceLimitAlerts,
      planLimitAlerts: deps.planLimitAlerts,
    });
  }

  /** Binds the lifecycle pipeline's own senders. */
  connect(commands: EventingCommands<BillingLifecyclePipeline>): void {
    this.#commands = commands;
  }

  /** A subscription that was not active became active on `plan`; a renewal never reaches this. */
  async subscriptionActivated(input: {
    organizationId: string;
    subscriptionId: string;
    plan: string;
  }): Promise<void> {
    const { organizationId } = input;
    await this.#subscriptionChanged({
      organizationId,
      hasSubscription: () => Promise.resolve(true),
    });
    await this.usageBillingChanged({ organizationId });
    await this.#record(organizationId, async (commands) => {
      const members = await this.deps.organizations.getAllMembers({ organizationId });
      await commands.recordSubscriptionStarted.send({
        tenantId: organizationId,
        occurredAt: nowInstant().epochMilliseconds,
        ...input,
        memberUserIds: members.map((member) => member.id),
      });
    });
  }

  /** Whether the organization still holds another live subscription is read after the cancel. */
  async subscriptionCancelled(input: { organizationId: string }): Promise<void> {
    await this.#subscriptionChanged({
      ...input,
      hasSubscription: async () =>
        (await this.deps.subscriptions.findLastNonCancelled(input.organizationId)) != null,
    });
    await this.usageBillingChanged(input);
  }

  /**
   * Records whether the meter bills the organization, after a write that may change it committed.
   * Each attempt re-stamps before it reads billing, so no fact out-stamps its answer. A Stripe
   * redelivery never re-sends a lost fact, so a failed send is retried here, and a last failure
   * names the catch-up that fixes it. Never throws (ADR-174 decision 17).
   */
  async usageBillingChanged({ organizationId }: { organizationId: string }): Promise<void> {
    const pause = this.deps.pause ?? pauseFor;
    for (let attempt = 1; attempt <= USAGE_BILLING_SEND_ATTEMPTS; attempt += 1) {
      try {
        if (!this.#commands) {
          throw new Error("billing_lifecycle pipeline senders are not connected yet");
        }
        await this.#sendUsageBilling({
          commands: this.#commands,
          organizationId,
          fromCatchUp: false,
        });
        return;
      } catch (error) {
        if (attempt === USAGE_BILLING_SEND_ATTEMPTS) {
          (this.deps.logger ?? logger).error(
            { error, organizationId },
            "a usage-billing fact was not recorded; re-run usage-billing-catch-up",
          );
          return;
        }
        await pause(USAGE_BILLING_FIRST_PAUSE_MS * 2 ** (attempt - 1));
      }
    }
  }

  /**
   * The usage-billing catch-up's fact for one organization, stamped when it reads billing and
   * keyed by that read, so a re-run is a new fact (ADR-174 decision 17). Throws, unlike the
   * real fact, so the hand-run task stops on the organization it could not record. A dry run
   * reads billing and answers what it would record, recording nothing.
   */
  async usageBillingCaughtUp({
    organizationId,
    isDryRun = false,
  }: {
    organizationId: string;
    isDryRun?: boolean;
  }): Promise<{ usageBilled: boolean }> {
    if (isDryRun) return this.#usageBilledOf({ organizationId });
    if (!this.#commands) {
      throw new Error("billing_lifecycle pipeline senders are not connected yet");
    }
    return this.#sendUsageBilling({ commands: this.#commands, organizationId, fromCatchUp: true });
  }

  /** Stamped before billing is read, and answered by the meter's one rule. */
  async #sendUsageBilling({
    commands,
    organizationId,
    fromCatchUp,
  }: {
    commands: EventingCommands<BillingLifecyclePipeline>;
    organizationId: string;
    fromCatchUp: boolean;
  }): Promise<{ usageBilled: boolean }> {
    const occurredAt = (this.deps.now ?? nowInstant)().epochMilliseconds;
    const { usageBilled } = await this.#usageBilledOf({ organizationId });
    await commands.recordUsageBillingChanged.send({
      tenantId: organizationId,
      occurredAt,
      organizationId,
      usageBilled,
      fromCatchUp,
    });
    return { usageBilled };
  }

  async #usageBilledOf({ organizationId }: { organizationId: string }) {
    const lookup = await this.deps.billingOrganizations.getOrganizationForBilling(organizationId);
    return { usageBilled: usageBilledOf({ lookup }).usageBilled };
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
