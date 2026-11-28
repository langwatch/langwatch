// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Digest's two pipelines on an in-memory event and process store, over its memory twins, with
 * the peers it asks scripted and the mail channel's memory tier recording every email. The
 * plan and send intents are carried out the way the outbox carries them out.
 */
import {
  type AnalyticsApi,
  type AnalyticsSeries,
  buildSeriesName,
} from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  metricFactsContributionSchema,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  spanFactsContributionSchema,
} from "@langwatch/coding-agent-contract";
import {
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
  type EvaluationLifecycleCompletedEventData,
  evaluationLifecycleCompletedEventDataSchema,
} from "@langwatch/evaluation-contract";
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
import { ReactEmailMailRenderer } from "@langwatch/mail";
import { MemberNotFoundError } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  simulationRunFinishedEventDataSchema,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { type Instant, Temporal } from "@langwatch/time";
import {
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  type UserApi,
  userErasedEventDataSchema,
} from "@langwatch/user-contract";
import { z } from "zod";

import { DigestMailChannel, type RenderedDigestMail } from "../../channels/digest-mail.channel.ts";
import { MemoryDigestMailChannel } from "../../channels/memory/memory.digest-mail.channel.ts";
import { MemoryDigestAudienceRepository } from "../../repositories/memory/memory.digest-audience.repository.ts";
import { MemoryDigestRepositories } from "../../repositories/memory/memory.digest.repositories.ts";
import { emptyProjectWeek, isoWeekOf } from "../../rules/digest-week.rules.ts";
import { DigestCommandsService } from "../../services/digest-commands.service.ts";
import { DigestSendService } from "../../services/digest-send.service.ts";
import { DigestSourceService } from "../../services/digest-source.service.ts";
import { DigestTestSendService } from "../../services/digest-test-send.service.ts";
import { DigestTraceReadService } from "../../services/digest-trace-read.service.ts";
import { DigestUnsubscribeService } from "../../services/digest-unsubscribe.service.ts";
import { DigestUserErasureService } from "../../services/digest-user-erasure.service.ts";
import { DigestWeekService } from "../../services/digest-week.service.ts";
import type { ProjectActivity, UserActivity } from "../digest-activity.events.ts";
import { buildDigestSendPipeline } from "../digest-send.pipeline.ts";
import {
  DIGEST_MEMBER_SEND_PROCESS_NAME,
  DIGEST_ORGANIZATION_PLAN_PROCESS_NAME,
  DIGEST_PLAN_INITIAL_STATE,
  DIGEST_PLAN_PROCESS_NAME,
  digestPlanWake,
} from "../digest-send.process.ts";
import { buildDigestPipeline } from "../digest.pipeline.ts";

export const ORGANIZATION = "org-1";
export const PROJECT = "project-1";
/** A second organization, with its own project and members once a test gives it some. */
export const OTHER_ORGANIZATION = "org-2";
export const OTHER_PROJECT = "project-2";
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
  userErased: { type: USER_ERASED_EVENT_TYPE, version: USER_LIFECYCLE_EVENT_VERSION },
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
      fact(SIMULATION_RUN_EVENT_TYPES.FINISHED, simulationRunFinishedEventDataSchema),
      fact(SPAN_FACTS_CONTRIBUTED_EVENT_TYPE, spanFactsContributionSchema),
      fact(METRIC_FACTS_CONTRIBUTED_EVENT_TYPE, metricFactsContributionSchema),
      fact(USER_ERASED_EVENT_TYPE, userErasedEventDataSchema),
    ])
    .build();
}

/** One member as the organization module answers them. */
type WorldMember = Readonly<{ userId: string; role: string; disabledAt: Instant | null }>;
// The send and week services narrow OrganizationApi and EntitlementApi to the fields they read,
// so the world's rows stay that narrow instead of padding every member and plan field.
type SendDeps = Parameters<typeof DigestSendService.create>[0];
type TestSendDeps = Parameters<typeof DigestTestSendService.create>[0];
type WeekDeps = Parameters<typeof DigestWeekService.create>[0];

/** What the test controls: who the organization's members are, and its projects. */
export function digestWorld() {
  const members: WorldMember[] = [
    { userId: ADMIN, role: "ADMIN", disabledAt: null },
    { userId: MEMBER, role: "MEMBER", disabledAt: null },
    { userId: OTHER_MEMBER, role: "MEMBER", disabledAt: null },
  ];
  return {
    members,
    /** Every organization the organization module lists; the digest includes all of them. */
    organizations: [ORGANIZATION] as string[],
    /** The second organization's members; it has none until a test gives it some. */
    otherMembers: [] as WorldMember[],
    /** Organizations whose member list cannot be read, as a deleted one's would not be. */
    failingOrganizations: new Set<string>(),
    /** Organizations the organization module has no name for. */
    unnamedOrganizations: new Set<string>(),
    /** Organizations of the hidden system kind, which the organization module's lists leave out. */
    systemOrganizations: new Set<string>(),
    /** People whose profile is deactivated. */
    deactivated: new Set<string>(),
    /** People whose account has no email address. */
    withoutAddress: new Set<string>(),
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
    /** What analytics answers for a project's week, by `projectId:isoWeek`; absent is a quiet week. */
    traceNumbers: new Map<
      string,
      {
        traces: number;
        errors?: number;
        tokens?: number;
        costUsd?: number;
        p50Ms?: number;
        p95Ms?: number;
        models?: Record<string, number>;
      }
    >(),
    /** Every analytics read the digest made, as `projectId:isoWeek:grouped?`. */
    analyticsReads: [] as string[],
    /** Analytics reads that fail, as `projectId:isoWeek`. */
    failingAnalytics: new Set<string>(),
    /** How long each analytics read takes, so a test can see how many run at once. */
    readDelayMs: 0,
    /** The most analytics reads in flight at once. */
    mostReadsAtOnce: 0,
    readsInFlight: 0,
    /** Organizations whose plan cannot be asked, and people whose send cannot be asked. */
    failingPlanRequests: new Set<string>(),
    failingSendRequests: new Set<string>(),
    /** How many organization plans the week's plan has asked; the fixture carries each out. */
    requestedPlans: 0,
    /** Organizations whose plan failed when carried out, as the outbox would retry them. */
    failedPlans: [] as string[],
    /** Projects the project module no longer lists as live: archived ones. */
    archivedProjects: new Set<string>(),
    /** Projects of the internal governance kind, which no email counts. */
    governanceProjects: new Set<string>(),
    /** Projects of the aggregate kind, which read their members and are never read for an email. */
    aggregateProjects: new Set<string>(),
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
  const memoryMail = MemoryDigestMailChannel.create();
  const mail = new FailsAfterAcceptingMailChannel(memoryMail);
  const now = () => Date.now() + world.clockOffsetMs;
  const users = worldUsers({ world });
  const unsubscribes = DigestUnsubscribeService.create({
    secret,
    limits: repositories.callCounter,
    audience,
    users,
    now,
  });

  const source = DigestSourceService.create({
    projects: createApiFixture<
      Pick<ProjectApi, "findOrganizationId" | "findPersonalWorkspaceOwner">
    >(
      {
        findOrganizationId: async (projectId) => organizationOfProject(projectId),
        findPersonalWorkspaceOwner: async ({ scopeId }) => {
          const ownerUserId = world.personalOwners.get(scopeId);
          return ownerUserId ? { ownerUserId } : null;
        },
      },
      "ProjectApi",
    ),
    recordProject: (activity) => commands.recordProject(activity),
    recordUser: (activity) => commands.recordUser(activity),
  });
  const organizationOfProject = (projectId: string): string | undefined => {
    if (projectId === OTHER_PROJECT) return OTHER_ORGANIZATION;
    return world.projects.includes(projectId) ? ORGANIZATION : undefined;
  };
  const membersIn = (organizationId: string): readonly WorldMember[] => {
    if (organizationId === ORGANIZATION) return world.members;
    if (organizationId === OTHER_ORGANIZATION) return world.otherMembers;
    return [];
  };
  const knownProject = (id: string) => world.projects.includes(id) || id === OTHER_PROJECT;
  const analytics = createApiFixture<Pick<AnalyticsApi, "getTimeseries">>(
    {
      getTimeseries: (input) => readAnalytics({ world, input }),
    },
    "AnalyticsApi",
  );
  const weeks = DigestWeekService.create({
    traces: DigestTraceReadService.create({ analytics, now }),
    projectWeeks: repositories.projectWeeks,
    userWeeks: repositories.userWeeks,
    entitlement: createApiFixture<WeekDeps["entitlement"]>(
      { getUsage: async () => world.usage },
      "EntitlementApi",
    ),
  });
  const organizations = createApiFixture<SendDeps["organizations"] & TestSendDeps["organizations"]>(
    {
      listMembers: async ({ organizationId, offset = 0, limit = Number.POSITIVE_INFINITY }) => {
        if (world.failingOrganizations.has(organizationId)) {
          throw new Error(`${organizationId} cannot be read`);
        }
        const members = membersIn(organizationId);
        return { members: members.slice(offset, offset + limit), totalCount: members.length };
      },
      getMember: async ({ organizationId, userId }) => {
        const members = membersIn(organizationId);
        const member = members.find((row) => row.userId === userId);
        if (!member) throw new MemberNotFoundError(userId);
        return member;
      },
      findProvisioningSummary: async (organizationId) =>
        !world.unnamedOrganizations.has(organizationId) ? summaryOf(organizationId) : null,
      listAllIds: async ({ after }: { after?: string } = {}) => pageOfIds({ world, after }),
      organizationIdsForMember: async ({ userId }) =>
        [ORGANIZATION, OTHER_ORGANIZATION].filter((organizationId) =>
          membersIn(organizationId).some((row) => row.userId === userId && row.disabledAt === null),
        ),
      findForOperators: async ({ organizationIds }) =>
        organizationIds
          .filter((id) => !world.systemOrganizations.has(id))
          .map((id) => ({
            ...summaryOf(id),
            memberCount: membersIn(id).length,
            administratorEmails: [],
          })),
    },
    "OrganizationApi",
  );
  const sends = DigestSendService.create({
    audience: repositories.audience,
    sends: repositories.sends,
    weeks,
    organizations,
    projects: createApiFixture<
      Pick<ProjectApi, "listNamesByIds" | "findLiveNonGovernanceIdsByOrganization">
    >(
      {
        findLiveNonGovernanceIdsByOrganization: async ({ organizationId }) =>
          (organizationId === OTHER_ORGANIZATION ? [OTHER_PROJECT] : world.projects).filter(
            (id) => !world.archivedProjects.has(id) && !world.governanceProjects.has(id),
          ),
        listNamesByIds: async ({ projectIds }) =>
          projectIds
            .filter(knownProject)
            .map((id) =>
              projectIdentity(id, world.personalOwners.get(id), world.aggregateProjects.has(id)),
            ),
      },
      "ProjectApi",
    ),
    access: createApiFixture<Pick<AuthzApi, "canBatchByIds">>(
      {
        canBatchByIds: async ({ principal, projects }) => {
          const viewer = principal.type === "user" ? principal.id : "";
          const hidden = world.hiddenFrom.get(viewer) ?? [];
          const decided = new Map<string, boolean>();
          for (const { projectId } of projects) decided.set(projectId, !hidden.includes(projectId));
          return { teams: new Map(), projects: decided, organizationRole: null };
        },
      },
      "AuthzApi",
    ),
    users,
    mail,
    renderer: ReactEmailMailRenderer.create(),
    unsubscribes,
    get publicBaseUrl() {
      return world.publicBaseUrl;
    },
    requestSend: async (request) => {
      if (world.failingSendRequests.has(request.userId)) throw new Error("cannot ask");
      await commands.requestSend(request);
    },
    requestOrganizationPlan: async (request) => {
      if (world.failingPlanRequests.has(request.organizationId)) throw new Error("cannot ask");
      world.requestedPlans += 1;
      await commands.requestOrganizationPlan(request);
    },
    now,
  });
  const tests = DigestTestSendService.create({ sends, users, organizations });

  const fold = eventing.register(
    buildDigestPipeline({
      projectWeeks: repositories.projectWeeks,
      userWeeks: repositories.userWeeks,
      source,
      erasure: DigestUserErasureService.create({
        audience: repositories.audience,
        sends: repositories.sends,
        userWeeks: repositories.userWeeks,
      }),
    }),
  );
  commands.connectActivity(fold.commands);
  const sendDefinition = buildDigestSendPipeline({ runner: sends, weeks });
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
  /** The organization plans the week's plan asked, leased and carried out as the outbox would. */
  let plansCarriedOut = 0;
  const carryOutOrganizationPlans = async () => {
    const spec = intentOf({
      processName: DIGEST_ORGANIZATION_PLAN_PROCESS_NAME,
      intent: "planOrganization",
    });
    plansCarriedOut += await drainLeased({
      expected: world.requestedPlans - plansCarriedOut,
      lease: () =>
        processStore.leaseDueMessages({
          now: Date.now() + 60_000,
          limit: 100,
          leaseDurationMs: 24 * 60 * 60 * 1000,
          processNames: [DIGEST_ORGANIZATION_PLAN_PROCESS_NAME],
        }),
      // The outbox would retry a failure; one organization failing must not stop the others.
      carryOut: (payload) =>
        spec
          .run(spec.schema.parse(payload), context(DIGEST_ORGANIZATION_PLAN_PROCESS_NAME))
          .catch(() =>
            world.failedPlans.push((payload as { organizationId: string }).organizationId),
          ),
    });
  };
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
    mail: memoryMail.sent,
    /** The mail channel digest sends through, for a test that makes it fail. */
    mailChannel: mail,
    unsubscribes,
    /** The hourly wake's plan of the sendable week, as the outbox carries it out. */
    plan: async ({ at = WAKE_AT, isoWeek = SENT_WEEK }: { at?: number; isoWeek?: string } = {}) => {
      const spec = intentOf({ processName: DIGEST_PLAN_PROCESS_NAME, intent: "planWeek" });
      // The plans asked before a failure are carried out all the same, as the outbox would.
      try {
        await spec.run(spec.schema.parse({ isoWeek, at }), context(DIGEST_PLAN_PROCESS_NAME));
      } finally {
        await carryOutOrganizationPlans();
      }
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
      await carryOutOrganizationPlans();
      return intents.length;
    },
    /** Every send intent still pending, oldest first; leasing them hands them out once. */
    leaseSends: () =>
      processStore.leaseDueMessages({
        now: Date.now() + 60_000,
        limit: 100,
        // Outlives the test: a lease that lapsed would hand the same intent out on the next call.
        leaseDurationMs: 24 * 60 * 60 * 1000,
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
    /** An operator's tests of their own week in every organization, once ops admitted them. */
    sendMyTests: (input: { operatorId: string }) => tests.sendMyTests(input),
    /** An operator's tests of another person's week, found by address, once ops admitted them. */
    sendTestFor: (input: Parameters<DigestTestSendService["sendTestFor"]>[0]) =>
      tests.sendTestFor(input),
    /** One organization's plan, as the outbox retries it after a failure. */
    planOrganization: (input: { organizationId: string; isoWeek?: string }) =>
      sends.planOrganization({ isoWeek: SENT_WEEK, ...input }),
    /** An organization's active roster, as the plan reads it page by page. */
    members: (input: { organizationId: string }) => sends.members(input),
    /** One fact on a project's week, through digest's own record command. */
    recordProject: (activity: ProjectActivity) => commands.recordProject(activity),
    ownerFact,
    /** One fact on a person's week, through digest's own record command. */
    recordUser: (activity: UserActivity) => commands.recordUser(activity),
    /** User's fact that a person was erased, appended to the stand-in log; its tenant is the person. */
    userErased: ({ userId }: { userId: string }) => {
      const occurredAt = Date.now();
      return ownerFact({
        fact: OWNER_FACTS.userErased,
        tenantId: userId,
        aggregateId: userId,
        occurredAt,
        data: { tenantId: userId, userId, occurredAt, organizationIds: [ORGANIZATION] },
      });
    },
    /** Evaluation's settled fact, appended to its stand-in log in order. */
    evaluationCompleted: (data: EvaluationLifecycleCompletedEventData) =>
      ownerFact({
        fact: OWNER_FACTS.evaluation,
        tenantId: data.tenantId,
        aggregateId: data.projectId,
        occurredAt: data.occurredAt,
        data,
      }),
    /** A project's finished week as the fold would have left it, for a test that needs numbers. */
    seedProjectWeek: ({
      organizationId,
      projectId,
      isoWeek = SENT_WEEK,
      traces,
    }: {
      organizationId: string;
      projectId: string;
      isoWeek?: string;
      traces: number;
    }) => {
      world.traceNumbers.set(`${projectId}:${isoWeek}`, { traces });
      return repositories.projectWeeks.store(
        {
          state: { ...emptyProjectWeek(), organizationId, projectId, isoWeek },
          cursor: { acceptedAt: 0, eventId: `seed-${organizationId}-${projectId}-${isoWeek}` },
          occurredAt: 0,
          createdAt: 0,
          updatedAt: 0,
          version: "1",
        },
        {
          aggregateId: projectId,
          tenantId: createTenantId(projectId),
          key: `seed:${organizationId}:${projectId}:${isoWeek}`,
        },
      );
    },
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

/**
 * The memory channel behind a wrapper that can lose the connection after the mailer accepted:
 * the email is recorded, then the call throws once.
 */
class FailsAfterAcceptingMailChannel extends DigestMailChannel {
  #failNext = false;

  constructor(private readonly inner: DigestMailChannel) {
    super();
  }

  /** The next email is taken, then the call fails. */
  failAfterAccepting(): void {
    this.#failNext = true;
  }

  async send(mail: RenderedDigestMail): Promise<void> {
    await this.inner.send(mail);
    if (!this.#failNext) return;
    this.#failNext = false;
    throw new Error("the connection closed after the mailer accepted the email");
  }
}

/** An organization as the organization module summarises it; the first is Acme, any other is named after its id. */
function summaryOf(id: string) {
  return {
    id,
    name: id === ORGANIZATION ? "Acme" : `Org ${id}`,
    slug: id,
    createdAt: Temporal.Now.instant(),
  };
}

/** Which of the totals call's series a request series is, so the stub answers each its number. */
function seriesLabel(series: AnalyticsSeries): string {
  if (series.metric === "metadata.trace_id") return series.filters ? "errors" : "traces";
  if (series.metric === "performance.total_tokens") return "tokens";
  if (series.metric === "performance.total_cost") return "cost";
  return series.aggregation === "p95" ? "p95" : "median";
}

/** A project as the project module names it; every project sits on the one team. */
function projectIdentity(id: string, ownerUserId: string | undefined, aggregate: boolean) {
  return {
    id,
    name: "Support bot",
    slug: "support-bot",
    teamId: "team-1",
    organizationId: ORGANIZATION,
    isPersonal: ownerUserId !== undefined,
    ownerUserId: ownerUserId ?? null,
    kind: aggregate ? "aggregate" : "project",
  };
}

/** The user module over the world's people, found by id or by address. */
function worldUsers({ world }: { world: ReturnType<typeof digestWorld> }) {
  const profileOf = (id: string | undefined) =>
    id !== undefined && world.users.includes(id)
      ? userProfile(id, world.deactivated.has(id), world.withoutAddress.has(id))
      : null;
  return createApiFixture<Pick<UserApi, "findById" | "findByEmail">>(
    {
      findById: async ({ id }) => profileOf(id),
      findByEmail: async ({ email }) =>
        profileOf(world.users.find((known) => emailOf(known) === email)),
    },
    "UserApi",
  );
}

/** A person as the user module answers them: digest reads only the address. */
function userProfile(id: string, deactivated: boolean, withoutAddress: boolean) {
  const at = new Date("2026-01-01T00:00:00Z");
  return {
    id,
    name: null,
    email: withoutAddress ? null : emailOf(id),
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
    deactivatedAt: deactivated ? at : null,
  };
}

/**
 * Leases and carries out intents until `expected` have been, or nothing more arrives for a
 * while: one already asked this week queues nothing, so the wait must end.
 */
async function drainLeased({
  expected,
  lease,
  carryOut,
}: {
  expected: number;
  lease: () => Promise<readonly { payload: unknown }[]>;
  carryOut: (payload: unknown) => Promise<unknown>;
}): Promise<number> {
  let carried = 0;
  for (let idle = 0; carried < expected && idle < 20;) {
    const leased = await lease();
    idle = leased.length === 0 ? idle + 1 : 0;
    for (const { payload } of leased) await carryOut(payload);
    carried += leased.length;
    if (leased.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return carried;
}

/** What analytics answers for a read of a project's week, from the numbers the world holds. */
function answerFor({
  world,
  input,
  key,
}: {
  world: ReturnType<typeof digestWorld>;
  input: Parameters<AnalyticsApi["getTimeseries"]>[0];
  key: string;
}): Awaited<ReturnType<AnalyticsApi["getTimeseries"]>> {
  const numbers = world.traceNumbers.get(key);
  const named = (values: Record<string, number>) =>
    Object.fromEntries(
      input.series.map((series: AnalyticsSeries, index: number) => [
        buildSeriesName(series, index),
        values[seriesLabel(series)] ?? 0,
      ]),
    );
  if (input.groupBy) {
    const groups = Object.fromEntries(
      Object.entries(numbers?.models ?? {}).map(([model, count]) => [
        model,
        named({ traces: count }),
      ]),
    );
    return { previousPeriod: [], currentPeriod: [{ date: "full", [input.groupBy]: groups }] };
  }
  return {
    previousPeriod: [],
    currentPeriod: [
      {
        date: "full",
        ...named({
          traces: numbers?.traces ?? 0,
          errors: numbers?.errors ?? 0,
          tokens: numbers?.tokens ?? 0,
          cost: numbers?.costUsd ?? 0,
          median: numbers?.p50Ms ?? 0,
          p95: numbers?.p95Ms ?? 0,
        }),
      },
    ],
  };
}

/** One analytics read: recorded, possibly failing or slow, then answered from the world. */
async function readAnalytics({
  world,
  input,
}: {
  world: ReturnType<typeof digestWorld>;
  input: Parameters<AnalyticsApi["getTimeseries"]>[0];
}): Promise<Awaited<ReturnType<AnalyticsApi["getTimeseries"]>>> {
  const key = `${input.projectId}:${isoWeekOf(input.startDate)}`;
  world.analyticsReads.push(input.groupBy ? `${key}:grouped` : key);
  if (world.failingAnalytics.has(key)) throw new Error(`analytics cannot read ${key}`);
  world.readsInFlight += 1;
  world.mostReadsAtOnce = Math.max(world.mostReadsAtOnce, world.readsInFlight);
  try {
    if (world.readDelayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, world.readDelayMs));
    return answerFor({ world, input, key });
  } finally {
    world.readsInFlight -= 1;
  }
}

/** Organization ids one at a time, so a plan must page to reach them all. */
function pageOfIds({ world, after }: { world: ReturnType<typeof digestWorld>; after?: string }) {
  const ids = world.organizations.toSorted().filter((id) => after === undefined || id > after);
  const page = ids.slice(0, 1);
  return { ids: page, next: ids.length > 1 ? (page[0] ?? null) : null };
}
