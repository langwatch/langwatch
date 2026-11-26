// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  CioPersonTraits,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";
import type { UsageReportReceivedEventData } from "@langwatch/enterprise-saas-contract";
import type { GuidedOnboardingTurnFailedEventData } from "@langwatch/langy-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { PostHogChannel } from "../channels/posthog.channel.ts";
import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type { NurturingErasedUserRepository } from "../repositories/nurturing-erased-user.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import { fire as fireActivity } from "../rules/nurturing-activity-tracking-service.rules.ts";
import { isClaimedSignal } from "../rules/nurturing-claimed-calls.rules.ts";
import { selfHostedTraits, unixSecondsOf } from "../rules/nurturing-customer-io-timestamp.rules.ts";
import { pickCustomerIoDebounce } from "../rules/nurturing-delivery-debounce.rules.ts";
import {
  fireExperimentRan,
  fireScenarioCreated,
  fireTeamMemberInvited,
  fireWorkflowCreated,
} from "../rules/nurturing-feature-adoption-service.rules.ts";
import {
  fireGuidedOnboardingPaths,
  fireGuidedOnboardingProgress,
  fireGuidedTurnFailedPostHog,
  postHogUuidFor,
} from "../rules/nurturing-guided-onboarding-service.rules.ts";
import {
  firstSessionMemberTraits,
  isMemberFact,
  type KnownTraces,
  memberFactTraits,
} from "../rules/nurturing-member-facts.rules.ts";
import {
  fireInviteAccepted,
  fireMemberAdmitted,
  fireMemberRoleChanged,
  fireSsoAutoAdded,
} from "../rules/nurturing-membership-join-service.rules.ts";
import {
  fireEvaluationCompany,
  fireEvaluationCompleted,
  fireFirstTraceIntegrated,
  fireSimulationRunFinished,
} from "../rules/nurturing-milestone-calls.rules.ts";
import {
  fireIntegrationMethod,
  fireUsesCodingAgent,
  integrationMethodFor,
} from "../rules/nurturing-product-interest-service.rules.ts";
import { firePromptCreated } from "../rules/nurturing-prompt-creation-service.rules.ts";
import { customerIoRouteOf } from "../rules/nurturing-scenario-run-cap.rules.ts";
import {
  fireSignup,
  firstNameTraitOf,
} from "../rules/nurturing-signup-identification-service.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";
import { NurturingClaimedCallsDeliveryService } from "./nurturing-claimed-calls-delivery.service.ts";
import { NurturingCustomerIoSenderService } from "./nurturing-customer-io-sender.service.ts";
import { NurturingErasedPeopleService } from "./nurturing-erased-people.service.ts";
import { NurturingFailureReportService } from "./nurturing-failure-report.service.ts";
import type { NurturingGuidedOnboardingBackfillService } from "./nurturing-guided-onboarding-backfill.service.ts";
import { NurturingJoinedOrganizationService } from "./nurturing-joined-organization.service.ts";
import type { NurturingMemberFactsService } from "./nurturing-member-facts.service.ts";
import { NurturingOwnCodingDeliveryService } from "./nurturing-own-coding-delivery.service.ts";
import { NurturingPlanSyncService } from "./nurturing-plan-sync.service.ts";
import { NurturingPostHogDeliveryService } from "./nurturing-posthog-delivery.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

const { reportFailure } = NurturingFailureReportService;

/** Well under Customer.io's 500KB per batch: one member's identify is a few hundred bytes. */
const MEMBER_BATCH_SIZE = 100;

/** The same traits for each of these people. */
type MemberBatch = Readonly<{ userIds: readonly string[]; traits: Partial<CioPersonTraits> }>;

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
      /** Who hears an organization's fact, and what a joining person is told of traces. */
      memberFacts: NurturingMemberFactsService;
      /** Nurturing's member copy: a person is told the plan of their latest organization only. */
      members: Pick<NurturingOrganizationMemberRepository, "findMembershipsOfUsers">;
      /** Nurturing's erasure marks: no signal reaches an erased person. */
      erasedUsers: Pick<NurturingErasedUserRepository, "findErased">;
      /** A login's guided traits, sent once; absent where the deployment named no Customer.io key. */
      guidedBackfill?: NurturingGuidedOnboardingBackfillService;
    }>,
    private readonly parts: Readonly<{
      postHogDelivery: NurturingPostHogDeliveryService | undefined;
      ownCodingDelivery: NurturingOwnCodingDeliveryService | undefined;
      joinedOrganization: NurturingJoinedOrganizationService | undefined;
      claimedCalls: NurturingClaimedCallsDeliveryService | undefined;
      planSync: NurturingPlanSyncService;
      erasedPeople: NurturingErasedPeopleService;
      customerIoSender: NurturingCustomerIoSenderService | undefined;
    }>,
  ) {}

  static create(deps: NurturingDeliveryService["deps"]): NurturingDeliveryService {
    const { claims, customerIo, posthog } = deps;
    return new NurturingDeliveryService(deps, {
      postHogDelivery: posthog && NurturingPostHogDeliveryService.create(posthog),
      ownCodingDelivery:
        customerIo && NurturingOwnCodingDeliveryService.create({ claims, customerIo }),
      joinedOrganization:
        customerIo && NurturingJoinedOrganizationService.create({ claims, customerIo }),
      claimedCalls:
        customerIo &&
        NurturingClaimedCallsDeliveryService.create({
          claims,
          customerIo,
          windowSeconds: DELIVERED_WINDOW_SECONDS,
        }),
      planSync: NurturingPlanSyncService.create({
        customerIo,
        admins: deps.memberFacts,
        members: deps.members,
      }),
      erasedPeople: NurturingErasedPeopleService.create(deps.erasedUsers),
      customerIoSender: customerIo && NurturingCustomerIoSenderService.create(customerIo),
    });
  }

  /**
   * `key` names the signal: its kind and source event. A first session also tells its members. No
   * erased person hears it, however late it lands.
   */
  async deliver({ key, signal: named }: { key: string; signal: NurturingSignal }): Promise<void> {
    const catchUp = named.kind === "subscription_changed" && named.fromCatchUp === true;
    if (!catchUp && !this.deps.customerIo && !this.deps.posthog) return;
    // Before any claim: a failed read of the erasure marks fails the delivery, so it retries.
    const { signal, subjectErased } = await this.parts.erasedPeople.withoutErasedPeople(named);
    // Before any claim: a catch-up fact must fail, not vanish, when it is not delivered.
    if (signal.kind === "subscription_changed" && signal.fromCatchUp) {
      return this.parts.planSync.planCaughtUp(signal);
    }
    if (subjectErased) return this.deliverToOthers({ key, signal });
    // Before the delivered claim: a replay it stops must still send a failed joined_organization.
    await this.parts.joinedOrganization?.deliver(signal);
    const deliveredClaim = `nurturing:${key}`;
    if (!(await this.deps.claims.claim(deliveredClaim, DELIVERED_WINDOW_SECONDS))) return;
    this.sendCustomerIoCalls(fireEvaluationCompany(signal));
    if (await this.withinCustomerIoDebounce(signal)) return this.toPostHogSafely(signal);
    const memberBatch = await this.memberBatchOf({ signal, deliveredClaim });
    await this.toCustomerIo(signal, deliveredClaim);
    this.toPostHogSafely(signal);
    await this.identifyCodingAgentMembers(signal);
    await this.parts.ownCodingDelivery?.deliver(signal);
    await this.deps.guidedBackfill?.deliver(signal);
    if (memberBatch) this.identifyInBatches(memberBatch);
  }

  /**
   * A signal about an erased person: nothing is sent to them. An organization's fact is still
   * recorded and told to its other members, as a coding agent's first session still is.
   */
  private async deliverToOthers({
    key,
    signal,
  }: {
    key: string;
    signal: NurturingSignal;
  }): Promise<void> {
    if (!isMemberFact(signal) && signal.kind !== "coding_agent_first_session") return;
    const subject = "userId" in signal ? signal.userId : null;
    const deliveredClaim = `nurturing:${key}`;
    if (!(await this.deps.claims.claim(deliveredClaim, DELIVERED_WINDOW_SECONDS))) return;
    if (await this.withinCustomerIoDebounce(signal)) return;
    const memberBatch = await this.memberBatchOf({ signal, deliveredClaim });
    await this.identifyCodingAgentMembers(signal);
    if (!memberBatch) return;
    this.identifyInBatches({
      ...memberBatch,
      userIds: memberBatch.userIds.filter((userId) => userId !== subject),
    });
  }

  /**
   * An organization's fact reaches every active member's own profile, in bounded batches. Read
   * before anything is sent: a failed read gives back this delivery's claims and fails it, so the
   * queue's retry acts and no event goes out twice.
   */
  private async memberBatchOf({
    signal,
    deliveredClaim,
  }: {
    signal: NurturingSignal;
    deliveredClaim: string;
  }): Promise<MemberBatch | null> {
    if (!isMemberFact(signal) || !this.deps.customerIo) return null;
    try {
      return {
        userIds: await this.deps.memberFacts.recordFactAndClaimRecipients(signal),
        traits: memberFactTraits(signal),
      };
    } catch (error) {
      reportFailure(error);
      const debounce = pickCustomerIoDebounce(signal);
      return NurturingClaimReleaseService.create(this.deps.claims).rethrowAfterReleasing({
        error,
        keys: debounce ? [deliveredClaim, debounce.claimKey] : [deliveredClaim],
      });
    }
  }

  /** One request per batch, one after the other, so a large organization never opens a burst. */
  private identifyInBatches({ userIds, traits }: MemberBatch): void {
    const nurturing = this.deps.customerIo;
    if (!nurturing) return;
    void (async () => {
      for (let start = 0; start < userIds.length; start += MEMBER_BATCH_SIZE) {
        const batch = userIds.slice(start, start + MEMBER_BATCH_SIZE);
        await nurturing.batch(batch.map((userId) => ({ type: "identify", userId, traits })));
      }
    })().catch(reportFailure);
  }

  /**
   * A coding-agent organization's members each get uses_coding_agent once, claimed per person
   * so a redelivery or a second organization of theirs does not send it again in the window.
   * The first session's own traits go first: a member's claim that throws must not strand them.
   */
  private async identifyCodingAgentMembers(signal: NurturingSignal): Promise<void> {
    if (signal.kind !== "coding_agent_first_session" || !this.deps.customerIo) return;
    const members = new Set(signal.memberUserIds);
    this.identifyInBatches({
      // The admin's first session is already in fireCodingOrApp.
      userIds: [...members].filter((userId) => userId !== signal.userId),
      traits: firstSessionMemberTraits(signal),
    });
    for (const userId of members) {
      const claimKey = `nurturing:uses_coding_agent:${userId}`;
      if (!(await this.deps.claims.claim(claimKey, DELIVERED_WINDOW_SECONDS))) continue;
      // Sent at once, so a later member's claim failing never strands one already claimed.
      this.sendCustomerIoCalls(fireUsesCodingAgent({ userId }));
    }
  }

  /**
   * Langy's failed guided turn: PostHog only, once per source event, never to an erased person.
   * Only a failed read of the erasure marks fails the fact, before its claim, so it retries.
   */
  async deliverGuidedTurnFailed(data: GuidedOnboardingTurnFailedEventData): Promise<void> {
    const posthog = this.deps.posthog;
    if (!posthog) return;
    if (await this.parts.erasedPeople.isErased(data.userId)) return;
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
      this.parts.postHogDelivery?.send(signal);
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
    this.parts.customerIoSender?.send(calls);
  }

  private async toCustomerIo(signal: NurturingSignal, deliveredClaim: string): Promise<void> {
    if (!this.deps.customerIo) return;
    const route = customerIoRouteOf(signal);
    if (route.kind === "direct") return this.sendCustomerIoCalls(route.calls);
    // Each call is claimed on its own; a refused one fails the delivery, so its job retries.
    if (isClaimedSignal(signal)) {
      return this.parts.claimedCalls?.deliver({ signal, deliveredClaim });
    }
    switch (signal.kind) {
      case "scenario_created":
        return this.sendCustomerIoCalls(fireScenarioCreated(signal));
      case "workflow_created":
        return this.sendCustomerIoCalls(fireWorkflowCreated(signal));
      case "first_trace_integrated":
        return this.sendCustomerIoCalls(fireFirstTraceIntegrated(signal));
      case "simulation_run_finished":
        return this.sendCustomerIoCalls(fireSimulationRunFinished(signal));
      case "evaluation_completed":
        return this.sendCustomerIoCalls(fireEvaluationCompleted(signal));
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
        return this.sendWithTraces({
          ...signal,
          callsFor: (traces) => fireInviteAccepted({ signal, traces }),
        });
      case "member_role_changed":
        return this.sendCustomerIoCalls(fireMemberRoleChanged(signal));
      case "member_admitted":
        return this.sendCustomerIoCalls(fireMemberAdmitted(signal));
      case "sso_auto_added":
        return this.sendWithTraces({
          ...signal,
          callsFor: (traces) => fireSsoAutoAdded({ signal, traces }),
        });
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
        // A failed change gives its claim back and fails the delivery, so the job's retry sends it.
        return this.parts.planSync.planChanged(signal).catch((error: unknown) =>
          NurturingClaimReleaseService.create(this.deps.claims).rethrowAfterReleasing({
            error,
            keys: [deliveredClaim],
          }),
        );
      case "self_hosted_crm":
        return this.selfHostedCrm(signal);
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

  /** A join's calls, with what the person's organizations already know of traces. */
  private sendWithTraces({
    userId,
    organizationId,
    callsFor,
  }: {
    userId: string;
    organizationId: string;
    callsFor: (traces: KnownTraces | null) => CioBatchCall[];
  }): void {
    void this.tracesOrNull({ userId, organizationId })
      .then((traces) => this.sendCustomerIoCalls(callsFor(traces)))
      .catch(reportFailure);
  }

  /** Null when the read fails: a person's join or email must not be lost to it. */
  private tracesOrNull(person: {
    userId: string;
    organizationId: string;
  }): Promise<KnownTraces | null> {
    return this.deps.memberFacts.tracesOfPerson(person).catch((error: unknown) => {
      reportFailure(error);
      return null;
    });
  }

  /** The email has one home: read fresh from the user module at send time, never stored. */
  private sendSignup(signal: NurturingSignalOf<"signed_up">): void {
    void Promise.all([this.deps.users.findById({ id: signal.userId }), this.tracesOrNull(signal)])
      .then(([user, traces]) =>
        this.sendCustomerIoCalls(
          fireSignup({ ...signal, email: user?.email, name: user?.name, traces }),
        ),
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
              ...firstNameTraitOf(user?.name),
              createdAt: unixSecondsOf(signal.occurredAt),
            },
          },
        ]),
      )
      .catch(reportFailure);
  }

  /** Main's self-hosted CRM: traits on the organization, then one event per raised signal. */
  private selfHostedCrm(signal: NurturingSignalOf<"self_hosted_crm">): void {
    const nurturing = this.deps.customerIo;
    if (!nurturing) return;
    const { userId, organizationId, instanceId, events } = signal;
    void (async () => {
      const traits = selfHostedTraits(signal.traits);
      await nurturing.groupUser({ userId, groupId: organizationId, traits });
      for (const event of events) {
        await nurturing.trackEvent({ userId, event, properties: { instance_id: instanceId } });
      }
    })().catch(reportFailure);
  }
}
