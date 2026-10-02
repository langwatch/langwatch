// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";
import { onboardingExperimentProperties } from "@langwatch/onboarding-contract";
import { Temporal } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type { PostHogChannel } from "../channels/posthog.channel.ts";
import { fire as fireActivity } from "../rules/nurturing-activity-tracking-service.rules.ts";
import {
  fireExperimentRan,
  fireScenarioCreated,
  fireTeamMemberInvited,
  fireWorkflowCreated,
} from "../rules/nurturing-feature-adoption-service.rules.ts";
import {
  fireGuidedOnboardingPaths,
  fireGuidedOnboardingProgress,
} from "../rules/nurturing-guided-onboarding-service.rules.ts";
import {
  fireInviteAccepted,
  fireSsoAutoAdded,
} from "../rules/nurturing-membership-join-service.rules.ts";
import {
  fireIntegrationMethod,
  integrationMethodFor,
} from "../rules/nurturing-product-interest-service.rules.ts";
import { firePromptCreated } from "../rules/nurturing-prompt-creation-service.rules.ts";
import { fireSignup } from "../rules/nurturing-signup-identification-service.rules.ts";
import { fireSubscriptionSync } from "../rules/nurturing-subscription-sync-service.rules.ts";
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
 * Main's CRM contract, not a queue tunable: a tenant's trace, simulation or evaluation
 * update reaches Customer.io at most once in this window.
 */
const CIO_SYNC_DEBOUNCE_SECONDS = 5 * 60;
const CIO_SYNC_DEBOUNCED_KINDS = new Set<NurturingSignal["kind"]>([
  "trace_received",
  "simulation_run_finished",
  "evaluation_completed",
]);

function isoOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString({
    fractionalSecondDigits: 3,
  });
}

/**
 * Sends each recorded signal once, as main sent it: Customer.io through the
 * moved billing rules, PostHog as main's trackServerEvent. A sink that fails
 * only logs. @see specs/features/customer-io-nurturing-integration.feature
 */
export class NurturingDeliveryService {
  private constructor(
    private readonly deps: Readonly<{
      claims: Readonly<{ claim(key: string, ttlSeconds: number): Promise<boolean> }>;
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

  /** `key` names the signal: its kind and source event. */
  async deliver({ key, signal }: { key: string; signal: NurturingSignal }): Promise<void> {
    if (!this.deps.customerIo && !this.deps.posthog) return;
    if (!(await this.deps.claims.claim(`nurturing:${key}`, DELIVERED_WINDOW_SECONDS))) return;
    if (await this.withinCustomerIoDebounce(signal)) return this.toPostHog(signal);
    this.toCustomerIo(signal);
    this.toPostHog(signal);
  }

  /** True when this tenant's trace/simulation/evaluation update already sent this window. */
  private async withinCustomerIoDebounce(signal: NurturingSignal): Promise<boolean> {
    if (!CIO_SYNC_DEBOUNCED_KINDS.has(signal.kind)) return false;
    const claimed = await this.deps.claims.claim(
      `nurturing:cio-sync:${signal.kind}:${signal.tenantId}`,
      CIO_SYNC_DEBOUNCE_SECONDS,
    );
    return !claimed;
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
      case "scenario_run_succeeded":
      case "evaluation_ran":
      case "checkout_completed":
      case "project_active_day":
        return;
    }
  }

  private toPostHog(signal: NurturingSignal): void {
    const posthog = this.deps.posthog;
    if (!posthog) return;
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
      case "scenario_created": {
        const variant = signal.onboardingVariant;
        return track({
          userId: signal.userId,
          event: "scenario_created",
          properties: variant
            ? { onboarding_variant: variant, ...onboardingExperimentProperties(variant) }
            : {},
        });
      }
      case "scenario_run_succeeded":
        return track({
          userId: signal.userId,
          event: "scenario_run_succeeded",
          properties: {
            scenario_id: signal.scenarioId ?? null,
            run_id: signal.runId,
            connected_agent: true,
            ...onboardingExperimentProperties(signal.onboardingVariant),
          },
        });
      case "first_trace_integrated":
        return track({
          userId: signal.userId,
          event: "first_trace_integrated",
          properties: { sdk_language: signal.sdkLanguage, sdk_framework: signal.sdkFramework },
        });
      case "experiment_ran":
      case "evaluation_ran":
        return track({ userId: signal.userId, event: "evaluation_ran" });
      case "signed_up":
        return track({ userId: signal.userId, event: "signed_up" });
      case "team_member_invited":
        return track({
          userId: signal.userId,
          event: "team_member_invited",
          properties: { inviteCount: signal.roles.length },
        });
      case "checkout_completed":
        return this.checkoutCompleted({ posthog, signal });
      case "project_active_day":
        return track({
          userId: signal.userId,
          event: "project_active_day",
          properties: {
            source: signal.source,
            ...(signal.daysSinceSignup == null
              ? {}
              : { days_since_signup: signal.daysSinceSignup }),
            ...onboardingExperimentProperties(signal.onboardingVariant),
          },
        });
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
        traits: { has_simulations: true, simulation_count: 1, first_simulation_at: at },
      },
      {
        type: "track",
        userId,
        event: "first_simulation_ran",
        properties: { project_id: projectId },
      },
    ]);
  }

  /** Main's evaluation sync, plus `evaluation_ran` for every one; `first` picks the milestone. */
  private evaluationCompleted(signal: NurturingSignalOf<"evaluation_completed">): void {
    const { userId, projectId, organizationEvaluationCount: count } = signal;
    const at = isoOf(signal.occurredAt);
    const calls: CioBatchCall[] = signal.first
      ? [
          {
            type: "identify",
            userId,
            traits: { has_evaluations: true, evaluation_count: 1, first_evaluation_at: at },
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
