// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SSO_AUTO_ADDED_EVENT_TYPE, ssoAutoAddedEventDataSchema } from "@langwatch/auth-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  type Event,
  type MapProjectionDefinition,
  projectionLaneReplayer,
  type ReplayEvent,
  ReplayService,
  replayProjectionsOf,
  sealPipelineDefinition,
} from "@langwatch/eventing";
import { testEventSchema, IDLE_REPLAY_CLAIMS_INDEX } from "@langwatch/eventing/testing";
import {
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  recordVkLifecycleCommandDataSchema,
} from "@langwatch/gateway-contract";
import {
  IDENTITY_PIPELINE_NAME,
  USER_ERASED_EVENT_TYPE as IDENTITY_USER_ERASED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
  userErasedPayloadSchema,
} from "@langwatch/identity-contract";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ADMITTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  organizationCreatedEventDataSchema,
  organizationMemberAdmittedEventDataSchema,
  organizationMemberDisabledEventDataSchema,
  organizationMemberEnabledEventDataSchema,
  organizationMemberListedEventDataSchema,
  organizationMemberRemovedEventDataSchema,
  organizationSignedUpEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_LIFECYCLE_PIPELINE_NAME,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import {
  defineProjectionReplayStep,
  isMigrationStep,
  type LaneReplayer,
  type MigrationStep,
} from "@langwatch/upgrade/step";
import {
  USER_AGGREGATE_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  USER_LIFECYCLE_PIPELINE_NAME,
  userErasedEventDataSchema,
} from "@langwatch/user-contract";

import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingRepositories } from "../../repositories/nurturing.repositories.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_AUTH_MEMBERS_PROJECTION_NAME,
  NURTURING_ORGANIZATION_ADMINS_PROJECTION_NAME,
  NURTURING_ORGANIZATION_CREATIONS_PROJECTION_NAME,
  NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME,
  NURTURING_PROJECT_PLACEMENTS_PROJECTION_NAME,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  type NurturingUsageCopies,
  type NurturingUsageSync,
} from "../nurturing-project-usage.pipeline.ts";
import { allNurturingOwnerStandIns } from "./nurturing-owner-stand-ins.test-helpers.ts";
import {
  IDENTITY_MARKS_STEP,
  nurturingReplayStepsOver,
  USER_MARKS_STEP,
} from "./nurturing-replay-steps.test-helpers.ts";
import { NurturingSeededLog } from "./nurturing-seeded-log.test-helpers.ts";

export const PLACEMENTS_STEP = "nurturing:replay-project-placements";
export const ORGANIZATIONS_CREATED_STEP = "nurturing:replay-organizations-created";
export const ADMINS_STEP = "nurturing:replay-organization-admins";
export const MEMBERS_STEP = "nurturing:replay-organization-members";
export const AUTH_MEMBERS_STEP = "nurturing:replay-auth-members";
/** Project's own step, which records every project it held before it recorded creations. */
export const PROJECT_CREATED_FACTS_STEP = "project:record-created-facts";
/** Organization's own step, which lists the members it held before it recorded member facts. */
export const MEMBER_LISTING_STEP = "organization:list-member-facts";

const laneOf = (projection: string) => `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${projection}`;

/**
 * The placement, organization-creation, admin and member steps as nurturing.module.ts declares
 * them, rebuilt over a test's own replayer from the same pinned ids and lane constants. The
 * module's declaration test compares the module against this.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
export function organizationCopiesReplayStepsOver(replayer: LaneReplayer): MigrationStep[] {
  const common = { needsOldWritersGone: true, trailingPass: true, replayer } as const;
  return [
    defineProjectionReplayStep({
      ...common,
      id: PLACEMENTS_STEP,
      description:
        "Fills nurturing's project placement copy from project's created facts at deploy.",
      lane: laneOf(NURTURING_PROJECT_PLACEMENTS_PROJECTION_NAME),
      after: [PROJECT_CREATED_FACTS_STEP],
    }),
    defineProjectionReplayStep({
      ...common,
      id: ORGANIZATIONS_CREATED_STEP,
      description:
        "Fills nurturing's organization creation copy from organization's log at deploy.",
      lane: laneOf(NURTURING_ORGANIZATION_CREATIONS_PROJECTION_NAME),
    }),
    defineProjectionReplayStep({
      ...common,
      id: ADMINS_STEP,
      description:
        "Fills each organization's admin and seeded flag from project's created facts at deploy.",
      lane: laneOf(NURTURING_ORGANIZATION_ADMINS_PROJECTION_NAME),
      after: [USER_MARKS_STEP, IDENTITY_MARKS_STEP, PROJECT_CREATED_FACTS_STEP],
    }),
    defineProjectionReplayStep({
      ...common,
      id: MEMBERS_STEP,
      description: "Fills nurturing's member copy from organization's member facts at deploy.",
      lane: laneOf(NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME),
      after: [USER_MARKS_STEP, IDENTITY_MARKS_STEP, MEMBER_LISTING_STEP],
    }),
    defineProjectionReplayStep({
      ...common,
      id: AUTH_MEMBERS_STEP,
      description: "Fills nurturing's member copy from auth's single sign-on joins at deploy.",
      lane: laneOf(NURTURING_AUTH_MEMBERS_PROJECTION_NAME),
      after: [USER_MARKS_STEP, IDENTITY_MARKS_STEP],
    }),
  ];
}

/** An owner's pipeline as a stand-in declaring its events, as a worker registers it. */
function ownerStandIn({
  name,
  aggregateType,
  events,
}: Readonly<{
  name: string;
  aggregateType: string;
  events: Parameters<typeof testEventSchema>[];
}>) {
  return definePipeline({ name, aggregate: defineAggregate({ type: aggregateType }) })
    .withEvents(events.map(([type, data]) => testEventSchema(type, data)))
    .build();
}

/**
 * The owners whose facts the usage pipeline's copies take, one stand-in each declaring every type
 * a copy consumes from it, as a runtime registers them.
 */
export function nurturingCopyOwnerPipelines(): ReturnType<typeof ownerStandIn>[] {
  return [
    ownerStandIn({
      name: "governance_events",
      aggregateType: "governance_subject",
      events: [[GATEWAY_VK_LIFECYCLE_EVENT_TYPE, recordVkLifecycleCommandDataSchema]],
    }),
    ownerStandIn({
      name: USER_LIFECYCLE_PIPELINE_NAME,
      aggregateType: USER_AGGREGATE_TYPE,
      events: [[USER_ERASED_EVENT_TYPE, userErasedEventDataSchema]],
    }),
    ownerStandIn({
      name: IDENTITY_PIPELINE_NAME,
      aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
      events: [[IDENTITY_USER_ERASED_EVENT_TYPE, userErasedPayloadSchema]],
    }),
    ownerStandIn({
      name: PROJECT_LIFECYCLE_PIPELINE_NAME,
      aggregateType: PROJECT_AGGREGATE_TYPE,
      events: [[PROJECT_CREATED_EVENT_TYPE, projectCreatedEventDataSchema]],
    }),
    ownerStandIn({
      name: "organization_lifecycle",
      aggregateType: ORGANIZATION_AGGREGATE_TYPE,
      events: [
        [ORGANIZATION_CREATED_EVENT_TYPE, organizationCreatedEventDataSchema],
        [ORGANIZATION_SIGNED_UP_EVENT_TYPE, organizationSignedUpEventDataSchema],
        [INVITE_ACCEPTED_EVENT_TYPE, inviteAcceptedEventDataSchema],
        [ORGANIZATION_MEMBER_ADMITTED_EVENT_TYPE, organizationMemberAdmittedEventDataSchema],
        [ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE, organizationMemberRemovedEventDataSchema],
        [ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE, organizationMemberDisabledEventDataSchema],
        [ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE, organizationMemberEnabledEventDataSchema],
        [ORGANIZATION_MEMBER_LISTED_EVENT_TYPE, organizationMemberListedEventDataSchema],
      ],
    }),
    ownerStandIn({
      name: "auth_lifecycle",
      aggregateType: "user",
      events: [[SSO_AUTO_ADDED_EVENT_TYPE, ssoAutoAddedEventDataSchema]],
    }),
  ];
}

/** The copies the usage pipeline writes, over one composition's memory repositories. */
export function copiesOver(repositories: NurturingRepositories): NurturingUsageCopies {
  return {
    placements: repositories.placements,
    organizationsCreated: repositories.organizationsCreated,
    admins: repositories.milestones,
    members: repositories.members,
    virtualKeys: repositories.virtualKeys,
    personalProjects: repositories.personalProjects,
    tracedProjects: repositories.tracedProjects,
    lastTraces: repositories.milestones,
  };
}

let sequence = 0;
/** One owner fact as its log holds it, stamped in the order the test makes it. */
export function ownerFact({
  type,
  aggregateType,
  aggregateId,
  tenantId,
  data,
}: Readonly<{
  type: string;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  data: Readonly<Record<string, unknown>> & { occurredAt: number };
}>): ReplayEvent {
  const n = ++sequence;
  return {
    id: `fact-${n}`,
    aggregateId,
    aggregateType,
    tenantId,
    createdAt: 1_700_000_000_000 + n,
    timestamp: 1_700_000_000_000 + n,
    occurredAt: data.occurredAt,
    type,
    version: "2026-11-19",
    idempotencyKey: `fact-${n}`,
    data,
  };
}

/** User's erasure fact for one account, which the marks step replays. */
export function userErasedFact(userId: string): ReplayEvent {
  return {
    ...ownerFact({
      type: USER_ERASED_EVENT_TYPE,
      aggregateType: USER_AGGREGATE_TYPE,
      aggregateId: userId,
      tenantId: userId,
      data: { tenantId: userId, userId, occurredAt: 1 },
    }),
    version: USER_LIFECYCLE_EVENT_VERSION,
  };
}

/** A log event as a live delivery hands it to a lane: its tenant as the router brands it. */
export const liveEventOf = (event: ReplayEvent): Event =>
  ({ ...event, tenantId: createTenantId(event.tenantId) }) as Event;

/**
 * Every peer map of the usage pipeline as a worker registers it, live: each lane's parse of an
 * event, then its store, for every lane taking the event's type. The live oracle of a replay.
 */
export function liveMapsOver(
  copies: NurturingUsageCopies,
  sync?: NurturingUsageSync,
): (event: ReplayEvent) => Promise<void> {
  const { projectUsage, evaluationDays, traceDays, plans } = MemoryNurturingRepositories.create();
  const pipeline = buildNurturingProjectUsagePipeline({
    store: projectUsage,
    evaluationDays,
    traceDays,
    copies,
    plans: { store: plans, deliver: async () => undefined },
    sync,
  });
  const lanes: ((event: Event) => Promise<void>)[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: () => undefined,
    registerPeerFoldProjection: () => undefined,
    registerSubscriber: () => undefined,
    registerPeerMapProjection: <MapRecord, Own extends Event>(
      map: MapProjectionDefinition<MapRecord, Own>,
    ) => {
      // The router hands a lane only the types it declares; narrowing by them is the contract.
      const isOwn = (event: Event): event is Own => map.eventTypes.includes(event.type);
      lanes.push(async (event) => {
        if (!isOwn(event)) return;
        const record = map.map(event);
        if (record === null) return;
        await map.store.append(record, {
          tenantId: event.tenantId,
          aggregateId: event.aggregateId,
        });
      });
    },
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  return async (event) => {
    for (const lane of lanes) await lane(liveEventOf(event));
  };
}

/**
 * A worker's deploy over seeded owner logs: the usage pipeline over one composition's memory
 * repositories, and nurturing's replay steps over the real replay engine.
 */
export function copiesDeploy({
  events,
  repositories = MemoryNurturingRepositories.create(),
  copies = copiesOver(repositories),
  sync,
}: Readonly<{
  events: ReplayEvent[];
  repositories?: NurturingRepositories;
  /** The copies the lanes write, to fail or interleave a write. */
  copies?: NurturingUsageCopies;
  /** Registers the folds and syncs too, as a deployment with a Customer.io channel does. */
  sync?: NurturingUsageSync;
}>) {
  const log = new NurturingSeededLog(events);
  const pipeline = buildNurturingProjectUsagePipeline({
    store: repositories.projectUsage,
    evaluationDays: repositories.evaluationDays,
    traceDays: repositories.traceDays,
    copies,
    plans: { store: repositories.plans, deliver: async () => undefined },
    sync,
  });
  const projections = replayProjectionsOf([
    ...allNurturingOwnerStandIns(),
    sealPipelineDefinition(pipeline),
  ]);
  const replayer = projectionLaneReplayer({
    service: new ReplayService({
      claims: IDLE_REPLAY_CLAIMS_INDEX,
      eventSource: log,
      redis: memoryRedisDouble({
        script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
      }),
    }),
    projections,
  });
  const steps = [
    ...nurturingReplayStepsOver(replayer),
    ...organizationCopiesReplayStepsOver(replayer),
  ];
  const run = (id: string) => {
    const step = steps.find((each) => each.id === id);
    if (!step || !isMigrationStep(step)) throw new Error(`no step ${id}`);
    return step.run({
      log: { info: () => undefined, warn: () => undefined },
      checkpoint: { resumeFrom: null, save: async () => undefined },
      dryRun: false,
      signal: new AbortController().signal,
    });
  };
  /** Every step in the order the module declares them, as the upgrade runner orders them. */
  const runAll = async () => {
    for (const { id } of steps) await run(id);
  };
  return { repositories, log, steps, run, runAll };
}
