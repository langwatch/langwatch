// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Digest's two pipelines on an in-memory event and process store, over its memory twins, with
 * the peers it asks scripted and the mail channel's memory tier recording every email. The
 * plan and send intents are carried out the way the outbox carries them out.
 */
import {
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
  type EvaluationLifecycleCompletedEventData,
  evaluationLifecycleCompletedEventDataSchema,
} from "@langwatch/evaluation-contract";
import {
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  metricFactsContributionSchema,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  spanFactsContributionSchema,
} from "@langwatch/coding-agent-contract";
import {
  buildIntentAccessor,
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
  type IntentContext,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { MemberNotFoundError } from "@langwatch/organization-contract";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  simulationRunFinishedEventDataSchema,
} from "@langwatch/scenario-contract";
import {
  recordTraceSpanEventDataSchema,
  SPAN_RECORDED_EVENT_TYPE,
  SPAN_RECORDED_EVENT_VERSION_LATEST,
} from "@langwatch/trace-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { z } from "zod";

import { MemoryDigestMailChannel } from "../../channels/memory/memory.digest.channels.ts";
import { MemoryDigestAudienceRepository } from "../../repositories/memory/memory.digest-audience.repository.ts";
import { MemoryDigestRepositories } from "../../repositories/memory/memory.digest.repositories.ts";
import { DigestCommandsService } from "../../services/digest-commands.service.ts";
import { DigestSendService } from "../../services/digest-send.service.ts";
import { DigestSourceService } from "../../services/digest-source.service.ts";
import { DigestUnsubscribeService } from "../../services/digest-unsubscribe.service.ts";
import { DigestWeekService } from "../../services/digest-week.service.ts";
import type { ProjectActivity } from "../digest-activity.events.ts";
import { buildDigestSendPipeline } from "../digest-send.pipeline.ts";
import {
  DIGEST_MEMBER_SEND_PROCESS_NAME,
  DIGEST_PLAN_INITIAL_STATE,
  DIGEST_PLAN_PROCESS_NAME,
  digestPlanWake,
} from "../digest-send.process.ts";
import { buildDigestPipeline } from "../digest.pipeline.ts";

export const ORGANIZATION = "org-1";
export const PROJECT = "project-1";
export const ADMIN = "user-admin";
export const MEMBER = "user-member";
export const OTHER_MEMBER = "user-other";
export const OPERATOR = "user-operator";
export const BASE_URL = "https://app.example.test";
/** Each person's address, as the user module would answer it. */
export const emailOf = (userId: string) => `${userId}@example.test`;
/** A wake after Monday 08:00 UTC of 2026-W47: the sendable week is 2026-W46. */
export const WAKE_AT = Date.parse("2026-11-16T09:00:00Z");
export const NEXT_WAKE_AT = WAKE_AT + 60 * 60 * 1000;
export const SENT_WEEK = "2026-W46";
/** The session secret the fixture signs unsubscribe links with. */
export const DIGEST_SECRET = "digest-test-secret";

const OWNER_AGGREGATE_TYPE = "digest_owner_stand_in";

/** The owners' facts digest folds, each as its contract names the type, version and data. */
export const OWNER_FACTS = {
  evaluation: {
    type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
    version: EVALUATION_LIFECYCLE_EVENT_VERSION,
  },
  span: { type: SPAN_RECORDED_EVENT_TYPE, version: SPAN_RECORDED_EVENT_VERSION_LATEST },
  scenario: {
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
  },
  codingAgentSpan: {
    type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
    version: SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  },
  codingAgentMetric: {
    type: METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
    version: METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  },
} as const;

/** The owners' pipelines as their contracts name the facts; digest reads type and data. */
function ownerStandIn() {
  const fact = <Type extends string, Data extends z.ZodType>(type: Type, data: Data) =>
    z.object({ ...EventSchema.shape, type: z.literal(type), data });
  return definePipeline({
    name: "digest_owner_stand_in",
    aggregate: defineAggregate({ type: OWNER_AGGREGATE_TYPE }),
  })
    .withEvents([
      fact(EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE, evaluationLifecycleCompletedEventDataSchema),
      fact(SPAN_RECORDED_EVENT_TYPE, recordTraceSpanEventDataSchema),
      fact(SIMULATION_RUN_EVENT_TYPES.FINISHED, simulationRunFinishedEventDataSchema),
      fact(SPAN_FACTS_CONTRIBUTED_EVENT_TYPE, spanFactsContributionSchema),
      fact(METRIC_FACTS_CONTRIBUTED_EVENT_TYPE, metricFactsContributionSchema),
    ])
    .build();
}

/** One member as the organization module answers them. */
type WorldMember = Readonly<{ userId: string; role: string; disabledAt: Instant | null }>;

/** What the test controls: who the organization's members are, and its projects. */
export function digestWorld() {
  const members: WorldMember[] = [
    { userId: ADMIN, role: "ADMIN", disabledAt: null },
    { userId: MEMBER, role: "MEMBER", disabledAt: null },
    { userId: OTHER_MEMBER, role: "MEMBER", disabledAt: null },
  ];
  return {
    members,
    projects: [PROJECT],
    /** The projects each person may not view; everyone may view every other. */
    hiddenFrom: new Map<string, readonly string[]>(),
    usage: { currentMonthMessagesCount: 10, maxMonthlyUsageLimit: 1_000 },
    /** People the user module knows, by id; anyone else has no address. */
    users: [ADMIN, MEMBER, OTHER_MEMBER, OPERATOR],
    /** How far this process's clock runs ahead of the wall clock. */
    clockOffsetMs: 0,
    /** The deployment's public origin, read on each send so a test can misconfigure it. */
    publicBaseUrl: BASE_URL,
    /** The person behind each personal project, by project id; a shared project has none. */
    personalOwners: new Map<string, string>(),
  };
}

export function installDigest(
  world = digestWorld(),
  { secret = DIGEST_SECRET }: { secret?: string } = {},
) {
  // The concrete twin, so a test can read which send an opt-out came from.
  const audience = MemoryDigestAudienceRepository.create();
  const repositories = { ...MemoryDigestRepositories.create(), audience };
  const processStore = InMemoryProcessStore.createForTesting();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore,
  });
  // The test is the outbox: the runtime's own dispatcher and wake stay paused.
  eventing.processRuntime.pause();
  const commands = DigestCommandsService.create();
  const mail = MemoryDigestMailChannel.create();
  const now = () => Date.now() + world.clockOffsetMs;
  const unsubscribes = DigestUnsubscribeService.create({
    secret,
    audience,
    now,
  });

  const source = DigestSourceService.create({
    audience: repositories.audience,
    projects: {
      listIdsByOrganization: async ({ organizationId }) =>
        organizationId === ORGANIZATION ? world.projects : [],
      findPersonalWorkspaceOwner: async ({ scopeId }) => {
        const ownerUserId = world.personalOwners.get(scopeId);
        return ownerUserId ? { ownerUserId } : null;
      },
    },
    recordProject: (activity) => commands.recordProject(activity),
    recordUser: (activity) => commands.recordUser(activity),
    now,
  });
  const sends = DigestSendService.create({
    audience: repositories.audience,
    sends: repositories.sends,
    projectWeeks: repositories.projectWeeks,
    userWeeks: repositories.userWeeks,
    weeks: DigestWeekService.create({
      projectWeeks: repositories.projectWeeks,
      userWeeks: repositories.userWeeks,
      entitlement: {
        getUsage: async () => world.usage,
      },
    }),
    organizations: {
      listMembers: async ({ organizationId }) => {
        const members = organizationId === ORGANIZATION ? world.members : [];
        return { members, totalCount: members.length };
      },
      getMember: async ({ organizationId, userId }) => {
        const members = organizationId === ORGANIZATION ? world.members : [];
        const member = members.find((row) => row.userId === userId);
        if (!member) throw new MemberNotFoundError(userId);
        return member;
      },
      findProvisioningSummary: async (organizationId) =>
        organizationId === ORGANIZATION
          ? { id: ORGANIZATION, name: "Acme", slug: "acme", createdAt: Temporal.Now.instant() }
          : null,
    },
    projects: {
      findSummaryById: async (projectId) =>
        world.projects.includes(projectId) ? { name: "Support bot", slug: "support-bot" } : null,
      listNamesByIds: async ({ projectIds }) =>
        projectIds.filter((id) => world.projects.includes(id)).map(projectIdentity),
    },
    access: {
      canBatchByIds: async ({ principal, projects }) => {
        const viewer = principal.type === "user" ? principal.id : "";
        const hidden = world.hiddenFrom.get(viewer) ?? [];
        const decided = new Map<string, boolean>();
        for (const { projectId } of projects) decided.set(projectId, !hidden.includes(projectId));
        return { teams: new Map(), projects: decided, organizationRole: null };
      },
    },
    users: {
      findById: async ({ id }) => (world.users.includes(id) ? userProfile(id) : null),
    },
    mail,
    unsubscribes,
    get publicBaseUrl() {
      return world.publicBaseUrl;
    },
    requestSend: (request) => commands.requestSend(request),
    now,
  });

  const fold = eventing.register(
    buildDigestPipeline({
      projectWeeks: repositories.projectWeeks,
      userWeeks: repositories.userWeeks,
      source,
    }),
  );
  commands.connectActivity(fold.commands);
  const sendDefinition = buildDigestSendPipeline({
    runner: sends,
    deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
  });
  commands.connectSend(eventing.register(sendDefinition).commands);
  const owner = eventing.register(ownerStandIn());

  const intentOf = ({ processName, intent }: { processName: string; intent: string }) => {
    const spec = sendDefinition.processManagers.get(processName)?.config.intents[intent];
    if (!spec) throw new Error(`${processName} registered no ${intent} intent`);
    return spec;
  };
  /** The registered plan's own intents, so the wake emits through the runtime's accessor. */
  const planIntents = () => {
    const intents = sendDefinition.processManagers.get(DIGEST_PLAN_PROCESS_NAME)?.config.intents;
    if (!intents) throw new Error(`${DIGEST_PLAN_PROCESS_NAME} is not registered`);
    return intents;
  };
  const context = (processName: string): IntentContext => ({
    processName,
    projectId: ORGANIZATION,
    processKey: "test",
    tenantId: ORGANIZATION,
    messageKey: "test",
    attempt: 1,
  });
  let ownerEvents = 0;
  /** An owner's fact, appended to its stand-in log in order. */
  const ownerFact = async ({
    fact,
    tenantId,
    aggregateId,
    occurredAt,
    data,
  }: {
    fact: (typeof OWNER_FACTS)[keyof typeof OWNER_FACTS];
    tenantId: string;
    aggregateId: string;
    occurredAt: number;
    data: unknown;
  }) => {
    ownerEvents += 1;
    const tenant = createTenantId(tenantId);
    await owner.service.storeEvents(
      [
        {
          id: `owner-event-${ownerEvents}`,
          aggregateId,
          aggregateType: OWNER_AGGREGATE_TYPE,
          tenantId: tenant,
          type: fact.type,
          version: fact.version,
          createdAt: occurredAt + ownerEvents,
          occurredAt,
          data,
        },
      ] as Parameters<typeof owner.service.storeEvents>[0],
      { tenantId: tenant },
    );
  };

  return {
    world,
    repositories,
    /** Every email handed to the mail channel, in order. */
    mail: mail.sent,
    /** The mail channel itself, for a test that makes it fail. */
    mailChannel: mail,
    unsubscribes,
    /** The hourly wake's plan of the sendable week, as the outbox carries it out. */
    plan: async ({ at = WAKE_AT, isoWeek = SENT_WEEK }: { at?: number; isoWeek?: string } = {}) => {
      const spec = intentOf({ processName: DIGEST_PLAN_PROCESS_NAME, intent: "planWeek" });
      await spec.run(spec.schema.parse({ isoWeek, at }), context(DIGEST_PLAN_PROCESS_NAME));
    },
    /**
     * The hourly wake at `at`: its own handler decides whether a plan is asked, and each plan it
     * asks is carried out as the outbox would. Answers how many plans it asked.
     */
    wake: async ({ at }: { at: number }) => {
      const { intents = [] } = digestPlanWake(DIGEST_PLAN_INITIAL_STATE, {
        at,
        now: at,
        key: DIGEST_PLAN_PROCESS_NAME,
        projectId: ORGANIZATION,
        intent: buildIntentAccessor(planIntents()),
      });
      const spec = intentOf({ processName: DIGEST_PLAN_PROCESS_NAME, intent: "planWeek" });
      for (const intent of intents) {
        await spec.run(spec.schema.parse(intent.payload), context(DIGEST_PLAN_PROCESS_NAME));
      }
      return intents.length;
    },
    /** Every send intent still pending, oldest first; leasing them hands them out once. */
    leaseSends: () =>
      processStore.leaseDueMessages({
        now: Date.now() + 60_000,
        limit: 100,
        leaseDurationMs: 1,
        processNames: [DIGEST_MEMBER_SEND_PROCESS_NAME],
      }),
    /** Carries one send intent out the way the outbox does. */
    carryOut: async (payload: unknown) => {
      const spec = intentOf({ processName: DIGEST_MEMBER_SEND_PROCESS_NAME, intent: "sendDigest" });
      await spec.run(spec.schema.parse(payload), context(DIGEST_MEMBER_SEND_PROCESS_NAME));
    },
    /** An operator's test of a member's last week, as the app asks it once ops admitted them. */
    sendTest: (input: { organizationId: string; userId: string; operatorId: string }) =>
      sends.sendTest(input),
    /** One fact on a project's week, through digest's own record command. */
    recordProject: (activity: ProjectActivity) => commands.recordProject(activity),
    ownerFact,
    /** Evaluation's settled fact, appended to its stand-in log in order. */
    evaluationCompleted: (data: EvaluationLifecycleCompletedEventData) =>
      ownerFact({
        fact: OWNER_FACTS.evaluation,
        tenantId: data.tenantId,
        aggregateId: data.projectId,
        occurredAt: data.occurredAt,
        data,
      }),
    projectWeek: async ({ isoWeek }: { isoWeek: string }) => {
      const folds = await repositories.projectWeeks.findWeeks({
        isoWeeks: [isoWeek],
        organizationId: ORGANIZATION,
      });
      return folds.find((fold) => fold.projectId === PROJECT);
    },
    userWeek: async ({ isoWeek, userId }: { isoWeek: string; userId: string }) => {
      const folds = await repositories.userWeeks.findWeeks({
        isoWeeks: [isoWeek],
        organizationId: ORGANIZATION,
      });
      return folds.find((fold) => fold.userId === userId);
    },
    close: () => eventing.close(),
  };
}

export type InstalledDigest = ReturnType<typeof installDigest>;

/** A person as the user module answers them: digest reads only the address. */
/** A project as the project module names it; every project sits on the one team. */
function projectIdentity(id: string) {
  return {
    id,
    name: "Support bot",
    slug: "support-bot",
    teamId: "team-1",
    organizationId: ORGANIZATION,
    isPersonal: false,
    ownerUserId: null,
    kind: "project",
  };
}

function userProfile(id: string) {
  const at = new Date("2026-01-01T00:00:00Z");
  return {
    id,
    name: null,
    email: emailOf(id),
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
    deactivatedAt: null,
  };
}
