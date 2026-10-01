// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SessionStartedEventData, SsoAutoAddedEventData } from "@langwatch/auth-contract";
import type {
  CheckoutCompletedEventData,
  SubscriptionChangedEventData,
} from "@langwatch/enterprise-billing-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type {
  EvaluationLifecycleCompletedEventData,
  EvaluationRanEventData,
} from "@langwatch/evaluation-contract";
import type { ExperimentRanEventData } from "@langwatch/experiment-contract";
import type { GuidedOnboardingRecordedEventData } from "@langwatch/onboarding-contract";
import type {
  IntegrationMethodChosenEventData,
  InviteAcceptedEventData,
  MembersInvitedEventData,
  OrganizationSignedUpEventData,
} from "@langwatch/organization-contract";
import type { PromptCreatedEventData } from "@langwatch/prompt-contract";
import type {
  ScenarioCreatedEventData,
  SimulationRunFinishedEventData,
} from "@langwatch/scenario-contract";
import type {
  FirstTraceRecordedEventData,
  TraceReceivedEventData,
} from "@langwatch/trace-contract";
import type { WorkflowCreatedEventData } from "@langwatch/workflow-contract";

import { isConnectedAgentRunSucceeded } from "./nurturing-scenario-run.rules.ts";

/** The signal a peer's event raises, keyed by the aggregate and instant the event carries. */
type OwnerEvent<Data> = Readonly<{ data: Data; aggregateId: string }>;
/** An owner's event whose data names no tenant: the delivery context's is the event's own. */
type TenantEvent<Data> = OwnerEvent<Data> & Readonly<{ tenantId: string }>;

/** The picks reach nurturing as `guided_onboarding_paths`, the finished steps as progress. */
export function guidedOnboardingSignal({
  data,
  aggregateId,
}: OwnerEvent<GuidedOnboardingRecordedEventData>): NurturingSignal {
  const source = {
    sourceEventId: `${aggregateId}:${data.event}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: data.userId,
    organizationId: data.organizationId,
  };
  switch (data.event) {
    case "paths_selected":
    case "path_begun":
      return {
        kind: "guided_onboarding_paths",
        ...source,
        event: data.event,
        previousPaths: data.previousPaths,
        paths: data.state.paths,
      };
    case "provider_connected":
    case "tour_completed":
    case "tour_skipped":
    case "path_completed":
      return {
        kind: "guided_onboarding_progress",
        ...source,
        event: data.event,
        payload: data.payload,
        state: data.state,
      };
  }
}

/** Main told Customer.io of a full run of a saved experiment and PostHog of every run. */
export function experimentRanSignal({
  data,
  aggregateId,
}: OwnerEvent<ExperimentRanEventData>): NurturingSignal {
  return {
    kind: "experiment_ran",
    sourceEventId: `${aggregateId}:${data.userId}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: data.userId,
    projectId: data.projectId,
    experimentId: data.experimentId,
    fullRun: data.fullRun,
  };
}

/** A person's hand-run evaluation reaches PostHog alone, as main tracked it. */
export function evaluationRanSignal({
  data,
  aggregateId,
}: OwnerEvent<EvaluationRanEventData>): NurturingSignal {
  return {
    kind: "evaluation_ran",
    sourceEventId: `${aggregateId}:${data.userId}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: data.userId,
    projectId: data.projectId,
  };
}

/** The organization a settled evaluation was counted against, as nurturing's own store holds it. */
type CountedOrganization = Readonly<{
  adminUserId: string | null;
  seeded: boolean;
  evaluationCount: number;
}>;

/** A settled evaluation against the organization's admin; none where nurturing knows no admin. */
export function evaluationCompletedSignal({
  data,
  aggregateId,
  organization,
}: OwnerEvent<EvaluationLifecycleCompletedEventData> & {
  organization: CountedOrganization;
}): NurturingSignal[] {
  const { adminUserId, seeded, evaluationCount } = organization;
  if (!adminUserId) return [];
  return [
    {
      kind: "evaluation_completed",
      sourceEventId: `${aggregateId}:${data.evaluationId}`,
      tenantId: data.tenantId,
      occurredAt: data.occurredAt,
      userId: adminUserId,
      projectId: data.projectId,
      evaluationId: data.evaluationId,
      evaluatorType: data.evaluatorType,
      score: data.score,
      passed: data.passed,
      organizationEvaluationCount: evaluationCount,
      first: !seeded && evaluationCount === 1,
    },
  ];
}

/** Every member of the organization carries whether it holds a subscription. */
export function subscriptionChangedSignal({
  data,
  aggregateId,
}: OwnerEvent<SubscriptionChangedEventData>): NurturingSignal {
  return {
    kind: "subscription_changed",
    sourceEventId: `${aggregateId}:subscription:${data.hasSubscription}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    organizationId: data.organizationId,
    memberUserIds: data.memberUserIds,
    hasSubscription: data.hasSubscription,
  };
}

/** A completed checkout reaches PostHog as `subscription_created` and the organization group. */
export function checkoutCompletedSignal({
  data,
  aggregateId,
}: OwnerEvent<CheckoutCompletedEventData>): NurturingSignal {
  return {
    kind: "checkout_completed",
    sourceEventId: `${aggregateId}:${data.subscriptionId}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    organizationId: data.organizationId,
    subscriptionId: data.subscriptionId,
    checkoutCreatedAt: data.checkoutCreatedAt,
  };
}

/** A member's session, keyed by the person and its instant as auth's event is. */
export function sessionStartedSignal({
  data,
  aggregateId,
}: OwnerEvent<SessionStartedEventData>): NurturingSignal {
  return {
    kind: "session_started",
    sourceEventId: `${aggregateId}:${data.occurredAt}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId: data.userId,
    // Auth records only a member of an organization, so nurturing never makes a ghost person.
    hasOrganization: true,
  };
}

/** A domain auto-join, once per person and organization. */
export function ssoAutoAddedSignal({
  data,
  aggregateId,
}: OwnerEvent<SsoAutoAddedEventData>): NurturingSignal {
  const { tenantId, occurredAt, userId, organizationId, organizationName } = data;
  const sourceEventId = `${organizationId}:${aggregateId}`;
  const who = { userId, organizationId, organizationName };
  return { kind: "sso_auto_added", sourceEventId, tenantId, occurredAt, ...who };
}

/** An organization's sign-up, once per organization, with the questionnaire and the intent. */
export function signedUpSignal({
  data,
  aggregateId,
}: OwnerEvent<OrganizationSignedUpEventData>): NurturingSignal {
  const { tenantId, occurredAt, userId, organizationId, organizationName } = data;
  const who = { userId, organizationId, organizationName };
  const answers = { signUpData: data.signUpData, primaryIntent: data.primaryIntent };
  return {
    kind: "signed_up",
    sourceEventId: aggregateId,
    tenantId,
    occurredAt,
    ...who,
    ...answers,
  };
}

/** One invitation batch: a role per invite and the members counting it. */
export function membersInvitedSignal({
  data,
  aggregateId,
}: OwnerEvent<MembersInvitedEventData>): NurturingSignal {
  const { tenantId, occurredAt, userId, teamMemberCount, roles } = data;
  const sourceEventId = `${aggregateId}:${data.inviteIds.join(",")}`;
  const batch = { userId, teamMemberCount, roles };
  return { kind: "team_member_invited", sourceEventId, tenantId, occurredAt, ...batch };
}

/** An accepted invitation's person and organization. */
export function inviteAcceptedSignal({
  data,
  aggregateId,
}: OwnerEvent<InviteAcceptedEventData>): NurturingSignal {
  const { tenantId, occurredAt, userId, organizationId, organizationName } = data;
  const sourceEventId = `${aggregateId}:${data.inviteId}`;
  const who = { userId, organizationId, organizationName };
  return { kind: "invite_accepted", sourceEventId, tenantId, occurredAt, ...who };
}

/** A person's chosen integration method, under their own id. */
export function integrationMethodChosenSignal({
  data,
  aggregateId,
}: OwnerEvent<IntegrationMethodChosenEventData>): NurturingSignal {
  const { tenantId, occurredAt, userId, selection } = data;
  const sourceEventId = `${aggregateId}:${occurredAt}`;
  return {
    kind: "integration_method_chosen",
    sourceEventId,
    tenantId,
    occurredAt,
    userId,
    selection,
  };
}

/** A project's new prompt and the organization's count including it, once per prompt. */
export function promptCreatedSignal({
  data,
  aggregateId,
  tenantId,
}: TenantEvent<PromptCreatedEventData>): NurturingSignal {
  const { occurredAt, userId, projectId, orgPromptCount } = data;
  const counted = { userId, projectId, orgPromptCount };
  return { kind: "prompt_created", sourceEventId: aggregateId, tenantId, occurredAt, ...counted };
}

/** A created workflow and the project's count including it, once per workflow. */
export function workflowCreatedSignal({
  data,
  aggregateId,
  tenantId,
}: TenantEvent<WorkflowCreatedEventData>): NurturingSignal {
  const { occurredAt, userId, projectId, workflowId, workflowCount } = data;
  const counted = { userId, projectId, workflowId, workflowCount };
  return { kind: "workflow_created", sourceEventId: aggregateId, tenantId, occurredAt, ...counted };
}

/** A created scenario, the project's count including it and the onboarding variant, once each. */
export function scenarioCreatedSignal({
  data,
  aggregateId,
  tenantId,
}: TenantEvent<ScenarioCreatedEventData>): NurturingSignal {
  const { occurredAt, userId, projectId, scenarioId, scenarioCount, onboardingVariant } = data;
  const counted = { userId, projectId, scenarioId, scenarioCount, onboardingVariant };
  return { kind: "scenario_created", sourceEventId: aggregateId, tenantId, occurredAt, ...counted };
}

/** A connected agent's run that finished with a verdict, against the admin its event carries. */
export function scenarioRunSucceededSignal({
  data,
  aggregateId,
  tenantId,
}: TenantEvent<SimulationRunFinishedEventData>): NurturingSignal[] {
  const { organizationAdmin: admin, occurredAt } = data;
  if (!isConnectedAgentRunSucceeded(data) || !admin || occurredAt === undefined) return [];
  return [
    {
      kind: "scenario_run_succeeded",
      sourceEventId: aggregateId,
      tenantId,
      occurredAt,
      userId: admin.userId,
      projectId: tenantId,
      scenarioId: data.scenarioId,
      runId: data.scenarioRunId,
      onboardingVariant: admin.onboardingVariant,
    },
  ];
}

/** The organization a finished run was counted against, as nurturing's own store holds it. */
type CountedRunOrganization = Readonly<{
  adminUserId: string | null;
  seeded: boolean;
  simulationRunCount: number;
}>;

/** A finished run against the organization's admin; none where nurturing knows no admin. */
export function simulationRunFinishedSignal({
  data,
  aggregateId,
  tenantId,
  organization,
}: TenantEvent<SimulationRunFinishedEventData> & {
  organization: CountedRunOrganization;
}): NurturingSignal[] {
  const { adminUserId, seeded, simulationRunCount } = organization;
  const { occurredAt } = data;
  if (!adminUserId || occurredAt === undefined) return [];
  return [
    {
      kind: "simulation_run_finished",
      sourceEventId: aggregateId,
      tenantId,
      occurredAt,
      userId: adminUserId,
      projectId: tenantId,
      organizationRunCount: simulationRunCount,
      first: !seeded && simulationRunCount === 1,
    },
  ];
}

/** A project's first real trace against the admin trace recorded, once per project. */
export function firstTraceRecordedSignal({
  data,
  aggregateId,
}: OwnerEvent<FirstTraceRecordedEventData>): NurturingSignal {
  const { tenantId, occurredAt, userId, projectId, sdkLanguage, sdkFramework } = data;
  const sdk = { sdkLanguage, sdkFramework };
  const sourceEventId = aggregateId;
  return {
    kind: "first_trace_integrated",
    sourceEventId,
    tenantId,
    occurredAt,
    userId,
    projectId,
    ...sdk,
  };
}

/** A later real trace against the admin, keyed by the project and the trace's instant. */
export function traceReceivedSignal({
  data,
  aggregateId,
}: OwnerEvent<TraceReceivedEventData>): NurturingSignal {
  const { tenantId, occurredAt, userId, projectId } = data;
  const sourceEventId = `${aggregateId}:${occurredAt}`;
  return { kind: "trace_received", sourceEventId, tenantId, occurredAt, userId, projectId };
}
