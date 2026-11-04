// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";

import type { PostHogChannel } from "../channels/posthog.channel.ts";
import { isCodingOrAppSignal } from "../rules/nurturing-coding-delivery.rules.ts";
import {
  fireGuidedOnboardingPostHog,
  fireOnboardingVariantAssignedPostHog,
} from "../rules/nurturing-guided-onboarding-service.rules.ts";
import {
  activationTrackInput,
  evaluationsCompletedEvent,
} from "../rules/nurturing-posthog-activation.rules.ts";
import { fireOrganizationCreated } from "../rules/nurturing-signup-identification-service.rules.ts";
import { fireSubscriptionStarted } from "../rules/nurturing-subscription-sync-service.rules.ts";
import { isoOf } from "../rules/nurturing-time.rules.ts";

/** What a recorded signal tells PostHog, as main's trackServerEvent told it. */
export class NurturingPostHogDeliveryService {
  private constructor(private readonly posthog: PostHogChannel) {}

  static create(posthog: PostHogChannel): NurturingPostHogDeliveryService {
    return new NurturingPostHogDeliveryService(posthog);
  }

  /** Throws what the channel throws: the delivery that called it decides what a failure costs. */
  send(signal: NurturingSignal): void {
    const posthog = this.posthog;
    // The coding-agent and app-open signals go to Customer.io only.
    if (isCodingOrAppSignal(signal)) return;
    const track = ({
      userId,
      event,
      properties,
    }: {
      userId: string;
      event: string;
      properties?: Record<string, unknown>;
    }) =>
      posthog.track({
        userId,
        event,
        properties: {
          ...properties,
          ...("projectId" in signal ? { projectId: signal.projectId } : {}),
        },
      });
    switch (signal.kind) {
      case "guided_onboarding_paths":
        return posthog.track(
          fireGuidedOnboardingPostHog({
            userId: signal.userId,
            organizationId: signal.organizationId,
            event: signal.event,
            payload: signal.payload ?? {},
            paths: signal.paths,
            currentPath: undefined,
          }),
        );
      case "guided_onboarding_progress":
        return posthog.track(
          fireGuidedOnboardingPostHog({
            userId: signal.userId,
            organizationId: signal.organizationId,
            event: signal.event,
            payload: signal.payload,
            paths: signal.state.paths,
            currentPath: signal.state.currentPath,
          }),
        );
      case "onboarding_variant_assigned":
        return posthog.track(fireOnboardingVariantAssignedPostHog(signal));
      case "scenario_created":
      case "scenario_run_succeeded":
      case "first_trace_integrated":
      case "project_active_day":
        return track(activationTrackInput(signal));
      case "experiment_ran":
      case "evaluation_ran":
        return track({ userId: signal.userId, event: "evaluation_ran" });
      case "evaluation_completed":
        return track(evaluationsCompletedEvent(signal));
      case "user_registered":
        return track({ userId: signal.userId, event: "signed_up" });
      case "user_created":
        return posthog.identify({
          userId: signal.userId,
          properties: { created_at: isoOf(signal.occurredAt) },
        });
      case "signed_up":
        return posthog.track(fireOrganizationCreated(signal));
      case "team_member_invited":
        return track({
          userId: signal.userId,
          event: "team_member_invited",
          properties: { inviteCount: signal.roles.length },
        });
      case "subscription_started":
        return fireSubscriptionStarted(signal).forEach((event) => posthog.track(event));
      case "checkout_completed":
        return this.checkoutCompleted(signal);
      default:
        return;
    }
  }

  /** Main's checkout webhook: the organization's event, then its group properties. */
  private checkoutCompleted(signal: NurturingSignalOf<"checkout_completed">): void {
    const { organizationId, subscriptionId } = signal;
    this.posthog.track({
      userId: organizationId,
      event: "subscription_created",
      properties: { subscriptionId, $groups: { organization: organizationId } },
    });
    this.posthog.groupIdentify({
      groupType: "organization",
      groupKey: organizationId,
      properties: { subscriptionCreatedAt: signal.checkoutCreatedAt, hasActiveSubscription: true },
    });
  }
}
