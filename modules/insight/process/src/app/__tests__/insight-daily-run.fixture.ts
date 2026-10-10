/**
 * The insight module installed over memory with the peers a daily run asks, each scripted by
 * the test: who exists, who may read, which boards hold which widgets, and what Langy answers.
 * Who may open a board is not scripted: the dashboard module's own scope rules answer it.
 */

import type { AnalyticsApi, LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  type Dashboard,
  type DashboardApi,
  DashboardNotFoundError,
  type DashboardScope,
  dashboardStanding,
  type DashboardViewer,
  DEFAULT_DASHBOARD_SCOPE,
} from "@langwatch/dashboard-contract";
import {
  buildProcessDefinition,
  createTenantId,
  type IntentContext,
  ProcessManagerService,
} from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_RUN_PIPELINE_NAME,
  INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  INSIGHT_RUN_FINDINGS_FENCE_TAG,
  type InsightRunBoard,
  insightRunSettledEventDataSchema,
} from "@langwatch/insight-contract";
import {
  LangyIdempotencyMismatchError,
  type LangyApi,
  type LangyStartUnattendedTurnInput,
  type LangyTurnSettlementWait,
  type LangyTurnSettlementWaitInput,
} from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import { INSIGHT_DAILY_RUN_INTENT } from "../../eventing/insight-daily-run.intent.ts";
import {
  INSIGHT_DAILY_RUN_PROCESS_NAME,
  type InsightDailyRunState,
} from "../../eventing/insight-daily-run.process.ts";
import { INSIGHT_SCHEDULE_RECONCILE_INTENT } from "../../eventing/insight-daily-schedule-reconcile.intent.ts";
import { INSIGHT_SCHEDULE_RECONCILE_PROCESS_NAME } from "../../eventing/insight-daily-schedule-reconcile.process.ts";
import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import { installInsight, PROJECT } from "./insight.fixture.ts";

export const MEMBER = "user-member";
export const OTHER_MEMBER = "user-other";
export const BOARD: InsightRunBoard = { kind: "dashboard", id: "dashboard-1", name: "Costs" };
export const ORGANIZATION = "organization-1";

/** What the analytics module answers the run's person may see; a query is validated with it. */
export const PROTECTIONS: LangWatchQLProtections = {
  canSeeCosts: true,
  catalogue: { permissions: ["analytics:view", "traces:view"] },
};

type Project = NonNullable<Awaited<ReturnType<ProjectApi["findById"]>>>;
type Widget = Awaited<ReturnType<DashboardApi["listDashboardWidgets"]>>[number];

/** The queries the default board's two widgets store; a finding keeps no other. */
export const COST_QUERY = "from traces | sum(cost)";
export const ERRORS_QUERY = "from traces | count(errors)";

type ScriptedWidget = {
  id: string;
  name: string;
  queries?: string[];
  gridRow?: number;
  gridColumn?: number;
};

/**
 * A stored board. Left out, it is the run's own project's, at the scope Project, with no
 * author: what every board was before scope existed.
 */
type ScriptedBoard = {
  name: string;
  widgets: ScriptedWidget[];
  scope?: DashboardScope;
  createdById?: string;
  projectId?: string;
  organizationId?: string;
};

/** One finding as Langy writes it; a test adds or removes fields to make it good or bad. */
export function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Checkout cost doubled",
    body: "Cost on checkout rose from 41 to 96 dollars against the day before.",
    tone: "bad",
    ...overrides,
  };
}

/** An answer as Langy ends it: prose, then the one fenced block of findings. */
export function answerWith(findings: readonly Record<string, unknown>[]): string {
  const fence = "```";
  return [
    "I read each widget over the window.",
    "",
    `${fence}${INSIGHT_RUN_FINDINGS_FENCE_TAG}`,
    JSON.stringify({ findings }),
    fence,
  ].join("\n");
}

function project({ kind, archived }: { kind: string; archived: boolean }): Project {
  return {
    id: PROJECT,
    name: "Shop",
    slug: "shop",
    apiKey: "",
    lwqlKey: "",
    teamId: "team-1",
    language: "en",
    framework: "other",
    kind,
    firstMessage: true,
    integrated: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: archived ? new Date(0) : null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function widget({
  boardId,
  projectId,
  at,
  scripted,
}: {
  boardId: string;
  projectId: string;
  at: number;
  scripted: ScriptedWidget;
}): Widget {
  const instant = Temporal.Instant.fromEpochMilliseconds(0);
  return {
    id: scripted.id,
    projectId,
    name: scripted.name,
    definition: {
      version: 1,
      code: "",
      queries: (scripted.queries ?? []).map((sql, at) => ({ name: `query-${at}`, sql })),
    },
    createdAt: instant,
    updatedAt: instant,
    dashboardId: boardId,
    gridColumn: scripted.gridColumn ?? 0,
    gridRow: scripted.gridRow ?? at,
    colSpan: 1,
    rowSpan: 1,
  };
}

class PeerRefusal extends HandledError {}

/** A refusal as a peer module answers it: a handled error, told apart by its code alone. */
export function refusal(code: string): Error {
  return new PeerRefusal(code, `refused: ${code}`, { httpStatus: 403 });
}

/**
 * What the test controls. Each field is read when the run asks, so a test changes it between
 * two runs: remove a member's access, delete a board, turn the flag off.
 */
export function runWorld() {
  return {
    flagOn: true,
    project: { kind: "application", archived: false } as { kind: string; archived: boolean } | null,
    /** Who exists; `true` marks a deactivated account. */
    users: new Map<string, { deactivated: boolean }>([
      [MEMBER, { deactivated: false }],
      [OTHER_MEMBER, { deactivated: false }],
    ]),
    /** Who holds analytics:view in the project. */
    readers: new Set<string>([MEMBER, OTHER_MEMBER]),
    boards: new Map<string, ScriptedBoard>([
      [
        BOARD.id,
        {
          name: "Costs",
          widgets: [
            { id: "widget-cost", name: "Cost per day", queries: [COST_QUERY] },
            { id: "widget-errors", name: "Errors per day", queries: [ERRORS_QUERY] },
          ],
        },
      ],
    ]),
    /** Thrown by a board read when set, as the dashboard module refuses it. */
    boardReadError: null as Error | null,
    /** The queries the analytics module refuses, and its refusal to say what the person sees. */
    lwql: { refused: new Set<string>(), protectionsError: null as Error | null },
    langy: {
      /** Thrown by the start when set, as Langy refuses or fails it. */
      startError: null as Error | null,
      answer: answerWith([]),
      /** Replaces the settled answer when set: a failed turn, a question, a turn that hangs. */
      settle: null as
        | ((input: LangyTurnSettlementWaitInput) => Promise<LangyTurnSettlementWait>)
        | null,
    },
  };
}

export type RunWorld = ReturnType<typeof runWorld>;

function scriptedLangy(world: RunWorld) {
  const starts: LangyStartUnattendedTurnInput[] = [];
  const waits: LangyTurnSettlementWaitInput[] = [];
  const stops: { conversationId: string; turnId: string; userId: string }[] = [];
  /** Langy's own idempotency: one turn per key, and a key reused for other words is refused. */
  const turns = new Map<string, { text: string; conversationId: string; turnId: string }>();
  const api = createApiFixture<LangyApi>({
    startUnattendedTurn: async (input) => {
      starts.push(input);
      if (world.langy.startError) throw world.langy.startError;
      const known = turns.get(input.idempotencyKey);
      if (known && known.text !== input.text) throw new LangyIdempotencyMismatchError();
      const turn = known ?? {
        text: input.text,
        conversationId: `conversation-${turns.size + 1}`,
        turnId: `turn-${turns.size + 1}`,
      };
      turns.set(input.idempotencyKey, turn);
      return { conversationId: turn.conversationId, turnId: turn.turnId };
    },
    awaitTurnSettlement: async (input) => {
      waits.push(input);
      if (world.langy.settle) return world.langy.settle(input);
      return {
        kind: "settled",
        settlement: {
          succeeded: true,
          outcome: "completed",
          text: world.langy.answer,
          messageId: `message-of-${input.turnId}`,
          parts: [{ type: "text", text: world.langy.answer }],
          error: null,
        },
      };
    },
    stopTurn: async ({ conversationId, turnId, userId }) => {
      stops.push({ conversationId, turnId, userId });
    },
  });
  return { api, starts, waits, stops, turns };
}

function storedBoard({ id, board }: { id: string; board: ScriptedBoard }): Dashboard {
  return {
    id,
    projectId: board.projectId ?? PROJECT,
    name: board.name,
    order: 0,
    description: null,
    createdById: board.createdById ?? null,
    scope: board.scope ?? DEFAULT_DASHBOARD_SCOPE,
    organizationId: board.organizationId ?? null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

type BoardRead = { projectId: string; viewer?: DashboardViewer };

/**
 * The dashboard module's own answer to who opens a board from where, by its real scope rules.
 * A board the reader may not open is not found, exactly as one that does not exist.
 */
function boardReader(world: RunWorld) {
  const standingOf = ({ board, projectId, viewer }: BoardRead & { board: Dashboard }) =>
    dashboardStanding({ board, viewer, place: { projectId, organizationId: ORGANIZATION } });
  const stored = () =>
    [...world.boards].map(([id, board]) => ({ ...storedBoard({ id, board }), board }));
  return {
    open: ({ dashboardId, ...read }: BoardRead & { dashboardId: string }) => {
      const found = stored().find(({ id }) => id === dashboardId);
      if (!found || standingOf({ ...read, board: found }) === "none") {
        throw new DashboardNotFoundError(read.projectId);
      }
      return found;
    },
    /** The project's own boards the reader may see: a list by project reaches no other. */
    atHome: (read: BoardRead) =>
      stored().filter((board) => standingOf({ ...read, board }) === "home"),
  };
}

type BoardReadRecord = { read: "board" | "widgets"; viewer: unknown; dashboardId?: string };

function scriptedDashboard(world: RunWorld) {
  const boardReads: BoardReadRecord[] = [];
  const boards = boardReader(world);
  const widgetsOf = (found: Dashboard & { board: ScriptedBoard }) =>
    found.board.widgets.map((scripted, at) =>
      widget({ boardId: found.id, projectId: found.projectId, at, scripted }),
    );
  const dashboard = createApiFixture<DashboardApi>({
    getById: async ({ projectId, dashboardId, viewer }) => {
      boardReads.push({ read: "board", viewer });
      if (world.boardReadError) throw world.boardReadError;
      const { board: _board, ...found } = boards.open({ projectId, dashboardId, viewer });
      return { ...found, graphs: [] };
    },
    listDashboardWidgets: async ({ projectId, dashboardId, viewer }) => {
      boardReads.push({ read: "widgets", viewer, ...(dashboardId ? { dashboardId } : {}) });
      return dashboardId === undefined
        ? boards.atHome({ projectId, viewer }).flatMap(widgetsOf)
        : widgetsOf(boards.open({ projectId, dashboardId, viewer }));
    },
  });
  return { dashboard, boardReads };
}

function scriptedAnalytics(world: RunWorld) {
  const validations: { sql: string; protections: unknown; timeWindow: unknown }[] = [];
  const protectionAsks: { userId: string; projectId: string }[] = [];
  const analytics = createApiFixture<AnalyticsApi>({
    resolveProtections: async (input) => {
      protectionAsks.push(input);
      if (world.lwql.protectionsError) throw world.lwql.protectionsError;
      return PROTECTIONS;
    },
    validateLangWatchQL: ({ sql, protections, timeWindow }) => {
      validations.push({ sql, protections, timeWindow });
      if (world.lwql.refused.has(sql)) throw refusal("lwql_not_permitted");
      return { parameters: [], appFunctions: [] };
    },
  });
  return { analytics, validations, protectionAsks };
}

function scriptedPeers(world: RunWorld) {
  const user = createApiFixture<UserApi>({
    findById: async ({ id }) => {
      const known = world.users.get(id);
      if (!known) return null;
      return {
        id,
        name: "Riley",
        email: `${id}@example.test`,
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastLoginAt: null,
        deactivatedAt: known.deactivated ? new Date(0) : null,
      };
    },
  });
  const authz = createApiFixture<AuthzApi>({
    hasProjectPermission: async ({ userId, permission }) =>
      permission === "analytics:view" && world.readers.has(userId),
  });
  return { user, authz };
}

function intentContext({ attempt }: { attempt: number }): IntentContext {
  return {
    processName: INSIGHT_DAILY_RUN_PROCESS_NAME,
    projectId: PROJECT,
    processKey: "schedule",
    tenantId: PROJECT,
    messageKey: "run",
    attempt,
  };
}

export async function installDailyRuns(world: RunWorld = runWorld()) {
  const langy = scriptedLangy(world);
  const { dashboard, boardReads } = scriptedDashboard(world);
  const { analytics, ...lwql } = scriptedAnalytics(world);
  const installed = await installInsight({
    isEnabled: () => world.flagOn,
    peers: {
      ...scriptedPeers(world),
      dashboard,
      analytics,
      langy: langy.api,
      project: { findById: async () => (world.project ? project(world.project) : null) },
    },
  });
  const { eventing, eventStore, processStore } = installed;

  const scheduleIdOf = ({ userId = MEMBER, board = BOARD } = {}) =>
    dailyScheduleId({ projectId: PROJECT, userId, board });

  /** A process of the daily run pipeline as it was registered, to drive by hand. */
  const processOf = (processName: string) => {
    const definition = eventing.definitions
      .find(({ metadata }) => metadata.name === INSIGHT_DAILY_RUN_PIPELINE_NAME)
      ?.processManagers.get(processName);
    if (!definition) throw new Error(`The daily run pipeline registered no ${processName}`);
    return definition;
  };

  /** An intent as the pipeline registered it, to carry out by hand. */
  const intentOf = ({ processName, intent }: { processName: string; intent: string }) => {
    const spec = processOf(processName).config.intents?.[intent];
    if (!spec) throw new Error(`${processName} registered no ${intent} intent`);
    return spec;
  };
  const runIntent = () =>
    intentOf({ processName: INSIGHT_DAILY_RUN_PROCESS_NAME, intent: INSIGHT_DAILY_RUN_INTENT });

  const scheduleRefOf = (scope: { userId?: string; board?: InsightRunBoard } = {}) => ({
    processName: INSIGHT_DAILY_RUN_PROCESS_NAME,
    projectId: PROJECT,
    processKey: scheduleIdOf(scope),
  });

  return {
    ...installed,
    world,
    langy,
    boardReads,
    lwql,
    scheduleIdOf,
    /** Every outbox message the schedule's process wrote, oldest first. */
    intentsOf: (scope: { userId?: string; board?: InsightRunBoard } = {}) =>
      processStore.findMessagesByRef({ ref: scheduleRefOf(scope) }),
    /** The schedule's process instance: its state, and the wake it has armed. */
    instanceOf: (scope: { userId?: string; board?: InsightRunBoard } = {}) =>
      processStore.findByRef<InsightDailyRunState>({ ref: scheduleRefOf(scope) }),
    /** Handles every schedule wake due at `now`, as the wake worker does; answers how many. */
    wakeDue: async ({ now }: { now: number }) => {
      const manager = new ProcessManagerService({
        definition: buildProcessDefinition(processOf(INSIGHT_DAILY_RUN_PROCESS_NAME).config),
        store: processStore,
      });
      const due = await processStore.findDueWakes({
        now,
        limit: 20,
        processNames: [INSIGHT_DAILY_RUN_PROCESS_NAME],
      });
      for (const wake of due) await manager.handleWake({ wake, now });
      return due.length;
    },
    /** Drops the schedule's armed wake and keeps its state, as a lost wake leaves it. */
    loseWake: async (scope: { userId?: string; board?: InsightRunBoard } = {}) => {
      const ref = scheduleRefOf(scope);
      const instance = await processStore.findByRef({ ref });
      if (!instance) throw new Error("The schedule has no process instance to lose a wake on");
      await processStore.commit({
        ref,
        tenantId: instance.tenantId,
        sourceEventId: null,
        expectedRevision: instance.revision,
        state: instance.state,
        nextWakeAt: null,
        messages: [],
        now: instance.updatedAt,
      });
    },
    /** Carries one reconcile pass out, the way the outbox does for the hourly wake. */
    reconcile: async ({ passAt }: { passAt: number }) => {
      const spec = intentOf({
        processName: INSIGHT_SCHEDULE_RECONCILE_PROCESS_NAME,
        intent: INSIGHT_SCHEDULE_RECONCILE_INTENT,
      });
      await spec.run(spec.schema.parse({ scheduledFor: passAt }), intentContext({ attempt: 1 }));
    },
    /** The reconcile pass's process as the pipeline registered it. */
    reconcileProcess: () => processOf(INSIGHT_SCHEDULE_RECONCILE_PROCESS_NAME).config,
    /** Carries one intent out the way the outbox does, on the attempt named. */
    carryOut: async (payload: unknown, { attempt = 1 }: { attempt?: number } = {}) => {
      const spec = runIntent();
      await spec.run(spec.schema.parse(payload), intentContext({ attempt }));
    },
    /** The types of the events one schedule's stream holds, oldest first. */
    runEventsOf: async (scope: { userId?: string; board?: InsightRunBoard } = {}) => {
      const events = await eventStore.getEvents({
        aggregateId: scheduleIdOf(scope),
        aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
        context: { tenantId: createTenantId(PROJECT) },
      });
      return events.map((event) => event.type);
    },
    /** Every outcome one schedule's stream holds, oldest first: the run, how and why. */
    outcomesOf: async (scope: { userId?: string; board?: InsightRunBoard } = {}) => {
      const events = await eventStore.getEvents({
        aggregateId: scheduleIdOf(scope),
        aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
        context: { tenantId: createTenantId(PROJECT) },
      });
      return events
        .filter((event) => event.type === INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED)
        .map(({ data }) => insightRunSettledEventDataSchema.parse(data))
        .map(({ runId, outcome, reason }) => ({ runId, outcome, reason }));
    },
  };
}

export type InstalledDailyRuns = Awaited<ReturnType<typeof installDailyRuns>>;
