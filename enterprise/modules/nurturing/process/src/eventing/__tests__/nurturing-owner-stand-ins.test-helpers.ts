// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SSO_AUTO_ADDED_EVENT_TYPE } from "@langwatch/auth-contract";
import {
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_PIPELINE_NAME,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
} from "@langwatch/enterprise-billing-contract";
import {
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/evaluation-contract";
import {
  defineAggregate,
  definePipeline,
  type SealedPipelineDefinition,
  sealPipelineDefinition,
} from "@langwatch/eventing";
import { testEventSchema } from "@langwatch/eventing/testing";
import { GATEWAY_VK_LIFECYCLE_EVENT_TYPE } from "@langwatch/gateway-contract";
import {
  IDENTITY_PIPELINE_NAME,
  USER_ERASED_EVENT_TYPE as IDENTITY_USER_ERASED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ADMITTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
  PROJECT_LIFECYCLE_PIPELINE_NAME,
  PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
} from "@langwatch/project-contract";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  PROJECT_TRACED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  TRACE_FAILED_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import {
  USER_AGGREGATE_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/user-contract";
import { z } from "zod";

import { nurturingProjectUsagePeerEvents } from "../nurturing-project-usage.pipeline.ts";

/** An owner's pipeline as a stand-in: its event types, each with any data; the lanes parse it. */
function standIn({
  name,
  aggregateType,
  eventTypes,
}: Readonly<{
  name: string;
  aggregateType: string;
  eventTypes: readonly string[];
}>): SealedPipelineDefinition {
  return sealPipelineDefinition(
    definePipeline({ name, aggregate: defineAggregate({ type: aggregateType }) })
      .withEvents(eventTypes.map((type) => testEventSchema(type, z.unknown())))
      .build(),
  );
}

const typesOf = (events: readonly { type: string }[]) => events.map(({ type }) => type);

/**
 * Each owner pipeline the usage host's peer folds and maps read, as a worker installing nurturing
 * registers it: a replay finds each peer lane's owner by the event types it declares.
 */
export const nurturingOwnerStandIns = {
  user: () =>
    standIn({
      name: USER_LIFECYCLE_PIPELINE_NAME,
      aggregateType: USER_AGGREGATE_TYPE,
      eventTypes: [USER_ERASED_EVENT_TYPE],
    }),
  identity: () =>
    standIn({
      name: IDENTITY_PIPELINE_NAME,
      aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
      eventTypes: [IDENTITY_USER_ERASED_EVENT_TYPE],
    }),
  gateway: () =>
    standIn({
      name: "governance_events",
      aggregateType: "governance_subject",
      eventTypes: [GATEWAY_VK_LIFECYCLE_EVENT_TYPE],
    }),
  organization: () =>
    standIn({
      name: "organization_lifecycle",
      aggregateType: ORGANIZATION_AGGREGATE_TYPE,
      eventTypes: [
        ORGANIZATION_CREATED_EVENT_TYPE,
        ORGANIZATION_SIGNED_UP_EVENT_TYPE,
        INVITE_ACCEPTED_EVENT_TYPE,
        ORGANIZATION_MEMBER_ADMITTED_EVENT_TYPE,
        ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
        ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
        ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
        ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
        PERSONAL_TEAM_CREATED_EVENT_TYPE,
        PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
      ],
    }),
  project: () =>
    standIn({
      name: PROJECT_LIFECYCLE_PIPELINE_NAME,
      aggregateType: PROJECT_AGGREGATE_TYPE,
      eventTypes: [
        PROJECT_CREATED_EVENT_TYPE,
        PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
        PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
      ],
    }),
  trace: () =>
    standIn({
      name: "trace_project_milestones",
      aggregateType: "trace_project_milestone",
      eventTypes: [
        PROJECT_TRACED_EVENT_TYPE,
        FIRST_TRACE_RECORDED_EVENT_TYPE,
        TRACE_RECEIVED_EVENT_TYPE,
        TRACE_FAILED_EVENT_TYPE,
      ],
    }),
  traceProcessing: () =>
    standIn({
      name: "trace_processing",
      aggregateType: "trace",
      eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    }),
  auth: () =>
    standIn({
      name: "auth_lifecycle",
      aggregateType: "user",
      eventTypes: [SSO_AUTO_ADDED_EVENT_TYPE],
    }),
  evaluation: () =>
    standIn({
      name: EVALUATION_LIFECYCLE_PIPELINE_NAME,
      aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
      eventTypes: [EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE],
    }),
  billing: () =>
    standIn({
      name: BILLING_LIFECYCLE_PIPELINE_NAME,
      aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
      eventTypes: [SUBSCRIPTION_CHANGED_EVENT_TYPE],
    }),
  prompt: () =>
    standIn({
      name: "prompt",
      aggregateType: "prompt",
      eventTypes: typesOf(nurturingProjectUsagePeerEvents.prompt),
    }),
  evaluator: () =>
    standIn({
      name: "evaluator",
      aggregateType: "evaluator",
      eventTypes: typesOf(nurturingProjectUsagePeerEvents.evaluator),
    }),
  scenario: () =>
    standIn({
      name: "scenario",
      aggregateType: "scenario",
      eventTypes: typesOf(nurturingProjectUsagePeerEvents.scenario),
    }),
  simulation: () =>
    standIn({
      name: "simulation_processing",
      aggregateType: "simulation_run",
      eventTypes: typesOf(nurturingProjectUsagePeerEvents.simulation),
    }),
} as const;

/** Every owner stand-in: each peer lane's owner, with or without a Customer.io channel's sync. */
export function allNurturingOwnerStandIns(): SealedPipelineDefinition[] {
  return Object.values(nurturingOwnerStandIns).map((owner) => owner());
}
