// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";
import type { UsageReportReceivedEventData } from "@langwatch/enterprise-saas-contract";
import type { GuidedOnboardingTurnFailedEventData } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { UserApi } from "@langwatch/user-contract";

import type { PostHogChannel } from "../channels/posthog.channel.ts";
import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import { fire as fireActivity } from "../rules/nurturing-activity-tracking-service.rules.ts";
import { fireCodingOrApp, isCodingOrAppSignal } from "../rules/nurturing-coding-delivery.rules.ts";
import { pickCustomerIoDebounce } from "../rules/nurturing-delivery-debounce.rules.ts";
import {
  fireExperimentRan,
  fireScenarioCreated,
  fireTeamMemberInvited,
  fireWorkflowCreated,
} from "../rules/nurturing-feature-adoption-service.rules.ts";
import {
  fireGuidedOnboardingPaths,
  fireGuidedOnboardingPostHog,
  fireGuidedOnboardingProgress,
  fireGuidedTurnFailedPostHog,
  fireOnboardingVariantAssignedPostHog,
  postHogUuidFor,
} from "../rules/nurturing-guided-onboarding-service.rules.ts";
import {
  fireInviteAccepted,
  fireSsoAutoAdded,
} from "../rules/nurturing-membership-join-service.rules.ts";
import {
  activationTrackInput,
  evaluationsCompletedEvent,
} from "../rules/nurturing-posthog-activation.rules.ts";
import {
  fireCodingAgentIntegrationMethod,
  fireIntegrationMethod,
  integrationMethodFor,
} from "../rules/nurturing-product-interest-service.rules.ts";
import { firePromptCreated } from "../rules/nurturing-prompt-creation-service.rules.ts";
import {
  fireOrganizationCreated,
  fireSignup,
} from "../rules/nurturing-signup-identification-service.rules.ts";
import {
  fireSubscriptionStarted,
  fireSubscriptionSync,
} from "../rules/nurturing-subscription-sync-service.rules.ts";
import { isoOf } from "../rules/nurturing-time.rules.ts";
import type { NurturingService } from "./nurturing.service.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

/**
 * Where a fire-and-forget lifecycle signal's failure goes. Warn rather than error, and
 * swallowed rather than rethrown: the caller has already done the thing the customer asked
 * for, and a Customer.io outage is not the customer's problem.
 */
function reportFailure(error: unknown): void {
  nurturingLogger.warn({ error }, "a lifecycle signal could not be delivered");
}

/** How long a delivered signal is remembered against a redelivered source event. */
const DELIVERED_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/**
 * Sends each recorded signal once, as main sent it: Customer.io through the
 * moved billing rules, PostHog as main's trackServerEvent. A sink that fails
 * only logs. @see specs/features/customer-io-nurturing-integration.feature
 */
export class NurturingDeliveryService {
  private constructor(
    private readonly deps: Readonly<{
      claims: NurturingClaimRepository;
      /** Absent where the deployment named no Customer.io key. */
      customerIo: NurturingService | undefined;
      /** Absent where the deployment named no PostHog key. */
      posthog: PostHogChannel | undefined;
      /** The one nurturing -> user edge: signed_up reads the email fresh, never stores it. */
      users: UserApi;
    }>,
  ) {}

  static create(deps: NurturingDeliveryService["deps"]): NurturingDeliveryService {
    return new NurturingDeliveryService(deps);
  }

  /**
   * `key` names the signal: its kind and source event. A first session also identifies the
   * members.
   */
  async deliver({ key, signal }: { key: string; signal: NurturingSignal }): Promise<void> {
    if (!this.deps.customerIo && !this.deps.posthog) return;
    if (!(await this.deps.claims.claim(`nurturing:${key}`, DELIVERED_WINDOW_SECONDS))) return;
    if (await this.withinCustomerIoDebounce(signal)) return this.toPostHogSafely(signal);
    this.toCustomerIo(signal);
    this.toPostHogSafely(signal);
    await this.identifyCodingAgentMembers(signal);
  }

  /**
   * A coding-agent organization's members each get integration_method once, claimed per person
   * so a redelivery or a second organization of theirs does not send it again in the window.
   */
  private async identifyCodingAgentMembers(signal: NurturingSignal): Promise<void> {
    if (signal.kind !== "coding_agent_first_session" || !this.deps.customerIo) return;
    for (const userId of new Set(signal.memberUserIds)) {
      const claimKey = `nurturing:integration_method:coding_agent:${userId}`;
      if (!(await this.deps.claims.claim(claimKey, DELIVERED_WINDOW_SECONDS))) continue;
      // Sent at once, so a later member's claim failing never strands one already claimed.
      this.sendCustomerIoCalls(fireCodingAgentIntegrationMethod({ userId }));
    }
  }

  /** Langy's failed guided turn: PostHog only, once per source event, never failing the fact. */
  async deliverGuidedTurnFailed(data: GuidedOnboardingTurnFailedEventData): Promise<void> {
    const posthog = this.deps.posthog;
    if (!posthog) return;
    const key = `nurturing:guided_onboarding_turn_failed:${data.sourceEventId}`;
    if (!(await this.deps.claims.claim(key, DELIVERED_WINDOW_SECONDS))) return;
    try {
      posthog.track(fireGuidedTurnFailedPostHog(data));
    } catch (error) {
      reportFailure(error);
    }
  }

  /** A self-hosted install's usage report saas received: PostHog only, against the install id. */
  async deliverUsageReport({
    data,
    eventId,
  }: {
    data: UsageReportReceivedEventData;
    eventId: string;
  }): Promise<void> {
    const posthog = this.deps.posthog;
    if (!posthog) return;
    const key = `nurturing:usage_report_received:${eventId}`;
    if (!(await this.deps.claims.claim(key, DELIVERED_WINDOW_SECONDS))) return;
    try {
      posthog.track({
        userId: data.instanceId,
        event: data.event,
        properties: { ...data.properties, unknown_fields: data.unknownFields },
        uuid: postHogUuidFor(`nurturing-usage-report:${eventId}`),
      });
    } catch (error) {
      reportFailure(error);
    }
  }

  /** A PostHog channel that throws only logs: analytics never fails the delivery. */
  private toPostHogSafely(signal: NurturingSignal): void {
    try {
      this.toPostHog(signal);
    } catch (error) {
      reportFailure(error);
    }
  }

  /** True when this signal's debounce window already sent for its tenant or person. */
  private async withinCustomerIoDebounce(signal: NurturingSignal): Promise<boolean> {
    const debounce = pickCustomerIoDebounce(signal);
    if (!debounce) return false;
    return !(await this.deps.claims.claim(debounce.claimKey, debounce.seconds));
  }

  /** Runs a rule's decision against the configured Customer.io sink, one call at a time. */
  private sendCustomerIoCalls(calls: CioBatchCall[]): void {
    const nurturing = this.deps.customerIo;
    if (!nurturing) return;
    for (const call of calls) {
      switch (call.type) {
        case "identify":
          void nurturing
            .identifyUser({ userId: call.userId, traits: call.traits })
            .catch(reportFailure);
          break;
        case "track":
          void nurturing
            .trackEvent({ userId: call.userId, event: call.event, properties: call.properties })
            .catch(reportFailure);
          break;
        case "group":
          void nurturing
            .groupUser({ userId: call.userId, groupId: call.groupId, traits: call.traits })
            .catch(reportFailure);
          break;
      }
    }
  }

  private toCustomerIo(signal: NurturingSignal): void {
    if (!this.deps.customerIo) return;
    if (isCodingOrAppSignal(signal)) return this.sendCustomerIoCalls(fireCodingOrApp(signal));
    switch (signal.kind) {
      case "scenario_created":
        return this.sendCustomerIoCalls(fireScenarioCreated(signal));
      case "workflow_created":
        return this.sendCustomerIoCalls(fireWorkflowCreated(signal));
      case "first_trace_integrated":
        return this.firstTraceToCustomerIo(signal);
      case "trace_received":
        return this.identify({
          userId: signal.userId,
          traits: { last_trace_at: isoOf(signal.occurredAt) },
        });
      case "simulation_run_finished":
        return this.simulationRunFinished(signal);
      case "evaluation_completed":
        return this.evaluationCompleted(signal);
      case "experiment_ran":
        return this.experimentRan(signal);
      case "prompt_created":
        return this.sendCustomerIoCalls(firePromptCreated(signal));
      case "signed_up":
        return this.sendSignup(signal);
      case "user_created":
        return this.identifyCreated(signal);
      case "team_member_invited":
        return this.teamMemberInvited(signal);
      case "invite_accepted":
        return this.sendCustomerIoCalls(fireInviteAccepted({ signal }));
      case "sso_auto_added":
        return this.sendCustomerIoCalls(fireSsoAutoAdded({ signal }));
      case "session_started":
        return this.sendCustomerIoCalls(fireActivity(signal));
      case "integration_method_chosen":
        return this.sendCustomerIoCalls(
          fireIntegrationMethod({
            userId: signal.userId,
            integrationMethod: integrationMethodFor(signal.selection),
          }),
        );
      case "guided_onboarding_paths":
        return this.sendCustomerIoCalls(fireGuidedOnboardingPaths(signal));
      case "guided_onboarding_progress":
        return this.sendCustomerIoCalls(fireGuidedOnboardingProgress(signal));
      case "subscription_changed":
        return this.sendCustomerIoCalls(fireSubscriptionSync(signal));
      case "self_hosted_crm":
        return this.selfHostedCrm(signal);
      default:
        return;
    }
  }

  private toPostHog(signal: NurturingSignal): void {
    const posthog = this.deps.posthog;
    // The coding-agent and app-open signals go to Customer.io only.
    if (!posthog || isCodingOrAppSignal(signal)) return;
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
        return this.checkoutCompleted({ posthog, signal });
      default:
        return;
    }
  }

  private experimentRan(signal: NurturingSignalOf<"experiment_ran">): void {
    if (!signal.fullRun || !signal.experimentId) return;
    this.sendCustomerIoCalls(fireExperimentRan({ ...signal, experimentId: signal.experimentId }));
  }

  private teamMemberInvited(signal: NurturingSignalOf<"team_member_invited">): void {
    for (const role of signal.roles) {
      this.sendCustomerIoCalls(fireTeamMemberInvited({ ...signal, role }));
    }
  }

  private identify(input: Parameters<NurturingService["identifyUser"]>[0]): void {
    this.sendCustomerIoCalls([{ type: "identify", ...input }]);
  }

  /** The email has one home: read fresh from the user module at send time, never stored. */
  private sendSignup(signal: NurturingSignalOf<"signed_up">): void {
    void this.deps.users
      .findById({ id: signal.userId })
      .then((user) =>
        this.sendCustomerIoCalls(fireSignup({ ...signal, email: user?.email, name: user?.name })),
      )
      .catch(reportFailure);
  }

  /** A minted account: Customer.io learns the person, its address and name read fresh (§9). */
  private identifyCreated(signal: NurturingSignalOf<"user_created">): void {
    void this.deps.users
      .findById({ id: signal.userId })
      .then((user) =>
        this.sendCustomerIoCalls([
          {
            type: "identify",
            userId: signal.userId,
            traits: {
              ...(user?.email ? { email: user.email } : {}),
              ...(user?.name ? { name: user.name } : {}),
              createdAt: isoOf(signal.occurredAt),
            },
          },
        ]),
      )
      .catch(reportFailure);
  }

  /** Main's trace sync: the first trace's milestone, as the trace metadata subscriber saw it. */
  private firstTraceToCustomerIo(signal: NurturingSignalOf<"first_trace_integrated">): void {
    const { userId, projectId, sdkLanguage, sdkFramework } = signal;
    this.sendCustomerIoCalls([
      {
        type: "identify",
        userId,
        traits: {
          has_traces: true,
          sdk_language: sdkLanguage,
          sdk_framework: sdkFramework,
          first_trace_at: isoOf(signal.occurredAt),
        },
      },
      {
        type: "track",
        userId,
        event: "first_trace_integrated",
        properties: {
          sdk_language: sdkLanguage,
          sdk_framework: sdkFramework,
          project_id: projectId,
        },
      },
    ]);
  }

  /** Main's simulation sync: the organization's first run is a milestone, later ones a count. */
  private simulationRunFinished(signal: NurturingSignalOf<"simulation_run_finished">): void {
    const { userId, projectId, organizationRunCount } = signal;
    const at = isoOf(signal.occurredAt);
    if (!signal.first) {
      return this.identify({
        userId,
        traits: { simulation_count: organizationRunCount, last_simulation_at: at },
      });
    }
    this.sendCustomerIoCalls([
      {
        type: "identify",
        userId,
        traits: {
          has_simulations: true,
          simulation_count: organizationRunCount,
          first_simulation_at: at,
        },
      },
      {
        type: "track",
        userId,
        event: "first_simulation_ran",
        properties: { project_id: projectId },
      },
    ]);
  }

  /** Main's evaluation sync once per batch; `first` picks the milestone, `count` the batch's. */
  private evaluationCompleted(signal: NurturingSignalOf<"evaluation_completed">): void {
    const { userId, projectId, organizationEvaluationCount: count } = signal;
    const at = isoOf(signal.occurredAt);
    const calls: CioBatchCall[] = signal.first
      ? [
          {
            type: "identify",
            userId,
            traits: { has_evaluations: true, evaluation_count: count, first_evaluation_at: at },
          },
          {
            type: "track",
            userId,
            event: "first_evaluation_created",
            properties: { evaluation_type: signal.evaluatorType, project_id: projectId },
          },
        ]
      : [{ type: "identify", userId, traits: { evaluation_count: count, last_evaluation_at: at } }];
    calls.push({
      type: "track",
      userId,
      event: "evaluation_ran",
      properties: {
        evaluation_id: signal.evaluationId,
        score: signal.score,
        passed: signal.passed,
        count: signal.evaluationsCounted ?? 1,
      },
    });
    this.sendCustomerIoCalls(calls);
  }

  /** Main's self-hosted CRM: traits on the organization, then one event per raised signal. */
  private selfHostedCrm(signal: NurturingSignalOf<"self_hosted_crm">): void {
    const nurturing = this.deps.customerIo;
    if (!nurturing) return;
    const { userId, organizationId, instanceId, traits, events } = signal;
    void (async () => {
      await nurturing.groupUser({ userId, groupId: organizationId, traits });
      for (const event of events) {
        await nurturing.trackEvent({ userId, event, properties: { instance_id: instanceId } });
      }
    })().catch(reportFailure);
  }

  /** Main's checkout webhook: the organization's event, then its group properties. */
  private checkoutCompleted({
    posthog,
    signal,
  }: {
    posthog: PostHogChannel;
    signal: NurturingSignalOf<"checkout_completed">;
  }): void {
    const { organizationId, subscriptionId } = signal;
    posthog.track({
      userId: organizationId,
      event: "subscription_created",
      properties: { subscriptionId, $groups: { organization: organizationId } },
    });
    posthog.groupIdentify({
      groupType: "organization",
      groupKey: organizationId,
      properties: { subscriptionCreatedAt: signal.checkoutCreatedAt, hasActiveSubscription: true },
    });
  }
}
