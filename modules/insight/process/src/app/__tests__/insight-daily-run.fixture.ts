/**
 * The insight module installed over memory with the peers a daily run asks, each scripted by
 * the test: who exists, who may read, which boards hold which widgets, and what Langy answers.
 */

import type { AuthzApi } from "@langwatch/authz-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import { createTenantId, type IntentContext } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import {
  INSIGHT_DAILY_RUN_PIPELINE_NAME,
  INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  INSIGHT_RUN_FINDINGS_FENCE_TAG,
  type InsightRunBoard,
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
import { INSIGHT_DAILY_RUN_PROCESS_NAME } from "../../eventing/insight-daily-run.process.ts";
import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import { installInsight, PROJECT } from "./insight.fixture.ts";

export const MEMBER = "user-member";
export const OTHER_MEMBER = "user-other";
export const BOARD: InsightRunBoard = { kind: "dashboard", id: "dashboard-1", name: "Costs" };

type Project = NonNullable<Awaited<ReturnType<ProjectApi["findById"]>>>;
type Widget = Awaited<ReturnType<DashboardApi["listDashboardWidgets"]>>[number];

type ScriptedWidget = { id: string; name: string; gridRow?: number; gridColumn?: number };

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
  at,
  scripted,
}: {
  boardId: string;
  at: number;
  scripted: ScriptedWidget;
}): Widget {
  const instant = Temporal.Instant.fromEpochMilliseconds(0);
  return {
    id: scripted.id,
    projectId: PROJECT,
    name: scripted.name,
    definition: { version: 1, code: "", queries: [] },
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
    boards: new Map<string, { name: string; widgets: ScriptedWidget[] }>([
      [
        BOARD.id,
        {
          name: "Costs",
          widgets: [
            { id: "widget-cost", name: "Cost per day" },
            { id: "widget-errors", name: "Errors per day" },
          ],
        },
      ],
    ]),
    /** Thrown by a board read when set, as the dashboard module refuses it. */
    boardReadError: null as Error | null,
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

function scriptedPeers(world: RunWorld) {
  const boardReads: { read: "board" | "widgets"; viewer: unknown }[] = [];
  const dashboard = createApiFixture<DashboardApi>({
    getById: async ({ projectId, dashboardId, viewer }) => {
      boardReads.push({ read: "board", viewer });
      if (world.boardReadError) throw world.boardReadError;
      const board = world.boards.get(dashboardId);
      if (!board) throw refusal("dashboard_not_found");
      return {
        id: dashboardId,
        projectId,
        name: board.name,
        order: 0,
        description: null,
        createdById: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        graphs: [],
      };
    },
    listDashboardWidgets: async ({ viewer }) => {
      boardReads.push({ read: "widgets", viewer });
      return [...world.boards.entries()].flatMap(([boardId, board]) =>
        board.widgets.map((scripted, at) => widget({ boardId, at, scripted })),
      );
    },
  });
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
  return { dashboard, user, authz, boardReads };
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
  const { boardReads, ...peers } = scriptedPeers(world);
  const installed = await installInsight({
    isEnabled: () => world.flagOn,
    peers: {
      ...peers,
      langy: langy.api,
      project: { findById: async () => (world.project ? project(world.project) : null) },
    },
  });
  const { eventing, eventStore, processStore } = installed;

  const scheduleIdOf = ({ userId = MEMBER, board = BOARD } = {}) =>
    dailyScheduleId({ projectId: PROJECT, userId, board });

  /** The run's intent as the pipeline registered it, to carry out by hand. */
  const runIntent = () => {
    const spec = eventing.definitions
      .find(({ metadata }) => metadata.name === INSIGHT_DAILY_RUN_PIPELINE_NAME)
      ?.processManagers.get(INSIGHT_DAILY_RUN_PROCESS_NAME)?.config.intents?.[
      INSIGHT_DAILY_RUN_INTENT
    ];
    if (!spec) throw new Error("The daily run pipeline registered no runBoard intent");
    return spec;
  };

  return {
    ...installed,
    world,
    langy,
    boardReads,
    scheduleIdOf,
    /** Every outbox message the schedule's process wrote, oldest first. */
    intentsOf: (scope: { userId?: string; board?: InsightRunBoard } = {}) =>
      processStore.findMessagesByRef({
        ref: {
          processName: INSIGHT_DAILY_RUN_PROCESS_NAME,
          projectId: PROJECT,
          processKey: scheduleIdOf(scope),
        },
      }),
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
  };
}

export type InstalledDailyRuns = Awaited<ReturnType<typeof installDailyRuns>>;
