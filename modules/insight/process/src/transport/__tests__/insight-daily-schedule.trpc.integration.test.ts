/**
 * @vitest-environment node
 * The daily run setting on the real tRPC runtime over the installed module and the memory
 * tier: what a member turns on, reads, changes and turns off, and what another member of the
 * project is answered. Who may open a board is the dashboard module's own scope rule.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import {
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_RUN_EXPIRY_MS,
  type InsightRunBoard,
} from "@langwatch/insight-contract";
import { extractLangyTextFromParts, type LangyTurnSettlementWait } from "@langwatch/langy-contract";
import { testAuthorizeDefaults, trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerWith,
  BOARD,
  installDailyRuns,
  type InstalledDailyRuns,
  MEMBER,
  OTHER_MEMBER,
  stampedParts,
} from "../../app/__tests__/insight-daily-run.fixture.ts";
import { PROJECT } from "../../app/__tests__/insight.fixture.ts";
import { insightTrpcTransport } from "../insight.trpc.ts";

type TestContext = { actor: { id: string } };

const { CONFIGURED, TURNED_OFF, RUN_REQUESTED, RUN_STARTED, RUN_SETTLED } =
  INSIGHT_DAILY_RUN_EVENT_TYPES;
const VIEW = ["analytics:view"];
const VIEW_AND_ASK = ["analytics:view", "langy:create"];
const SCOPE = { projectId: PROJECT, board: { kind: BOARD.kind, id: BOARD.id } };
const ON = { projectId: PROJECT, board: BOARD, hour: 9, timezone: "Europe/Amsterdam" };
const OFF = { projectId: PROJECT, board: BOARD };
const RUN_NOW = { projectId: PROJECT, board: BOARD, maxInsights: 3 } as const;
const UNDECIDED = {
  state: "undecided",
  settings: null,
  lastRun: null,
  offReason: null,
  runInFlight: null,
};
const TEMPLATE: InsightRunBoard = { kind: "template", id: "llm-costs", name: "LLM costs" };
const PRIVATE_BOARD: InsightRunBoard = { kind: "dashboard", id: "dashboard-private", name: "Mine" };

/** An organisation admin on an aggregate: the admin gate admits, so the write guard decides. */
const ON_AGGREGATE: Pick<TrpcRuntimeMembers<TestContext>, "authorization"> = {
  authorization: {
    forRequest: () => ({
      ...testAuthorizeDefaults,
      projectKindOf: async () => "aggregate",
      getDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
      getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
    }),
  },
};

let installed: InstalledDailyRuns | undefined;

afterEach(async () => {
  await installed?.stop();
  installed = undefined;
});

/** One installed module, and a caller on it for each member a test names. */
async function project({ isEnabled = true }: { isEnabled?: boolean } = {}) {
  const daily = await installDailyRuns();
  installed = daily;
  daily.world.flagOn = isEnabled;

  const as = ({
    userId,
    held = VIEW_AND_ASK,
    isOnAggregate = false,
  }: {
    userId: string;
    held?: readonly string[];
    isOnAggregate?: boolean;
  }) => {
    const trpc = TrpcRootDefinition.forContext<TestContext>().create();
    return createTrpcRuntime<TestContext>({
      root: trpc,
      procedure: trpc.procedure,
      members: trpcTestMembers<TestContext>({
        permits: (permission) => held.includes(permission),
        ...(isOnAggregate ? { overrides: ON_AGGREGATE } : {}),
      }),
    })
      .mount(insightTrpcTransport, () => daily.app)
      .createCaller({ actor: { id: userId } });
  };

  return { as, daily };
}

/** What a caller is told when a request is refused: the wire code and the handled error. */
async function refusalOf(request: Promise<unknown>) {
  const refusal: unknown = await request.then(
    () => {
      throw new Error("The request was not refused");
    },
    (error: unknown) => error,
  );
  if (!(refusal instanceof Error)) throw new Error("The refusal is not an error");
  const cause: unknown = refusal.cause;
  const handled = typeof cause === "object" && cause !== null ? cause : {};
  return {
    code: "code" in refusal ? refusal.code : undefined,
    cause: {
      code: "code" in handled ? handled.code : undefined,
      message: "message" in handled ? handled.message : undefined,
      httpStatus: "httpStatus" in handled ? handled.httpStatus : undefined,
    },
  };
}

describe("given a member with analytics:view and a board they can open", () => {
  describe("when they turn their daily run on, change the hour and turn it off", () => {
    /** @scenario "A member turns their daily run on, reads it back, changes the hour and turns it off" */
    it("reads undecided, then on with what they chose, then the new hour, then off", async () => {
      const { as, daily } = await project();
      const member = as({ userId: MEMBER });

      const before = await member.getBoardDailyRun(SCOPE);
      await member.configureBoardDailyRun({ ...ON, maxInsights: 3 });
      const on = await member.getBoardDailyRun(SCOPE);
      await member.configureBoardDailyRun({ ...ON, hour: 17, maxInsights: 10 });
      const changed = await member.getBoardDailyRun(SCOPE);
      await member.turnOffBoardDailyRun(OFF);
      const off = await member.getBoardDailyRun(SCOPE);

      expect(before).toEqual(UNDECIDED);
      expect(on).toEqual({
        state: "on",
        settings: { hour: 9, timezone: "Europe/Amsterdam", maxInsights: 3 },
        lastRun: null,
        offReason: null,
        runInFlight: null,
      });
      expect(changed.settings).toEqual({ hour: 17, timezone: "Europe/Amsterdam", maxInsights: 10 });
      expect(off).toEqual({
        state: "off",
        settings: { hour: 17, timezone: "Europe/Amsterdam", maxInsights: 10 },
        lastRun: null,
        offReason: null,
        runInFlight: null,
      });
      expect(await daily.runEventsOf()).toEqual([CONFIGURED, CONFIGURED, TURNED_OFF]);
    });

    /** @scenario "A daily run keeps the stored board's own name, not the name that was sent" */
    it("keeps the board's own name on the row, whatever name the caller sent", async () => {
      const { as, daily } = await project();

      await as({ userId: MEMBER }).configureBoardDailyRun({
        ...ON,
        board: { ...BOARD, name: "Anything else" },
        maxInsights: 3,
      });

      const [row] = await daily.app.findDailyRuns({ projectId: PROJECT, userId: MEMBER });
      expect(row?.board).toEqual({ kind: "dashboard", id: BOARD.id, name: "Costs" });
    });
  });

  describe("when they say no thanks to the offer", () => {
    /** @scenario "No thanks from the offer stores off" */
    it("reads off with nothing chosen, and can still be turned on", async () => {
      const member = (await project()).as({ userId: MEMBER });

      await member.turnOffBoardDailyRun(OFF);
      const declined = await member.getBoardDailyRun(SCOPE);
      await member.configureBoardDailyRun({ ...ON, maxInsights: 5 });

      expect(declined).toEqual({ ...UNDECIDED, state: "off" });
      expect(await member.getBoardDailyRun(SCOPE)).toMatchObject({ state: "on" });
    });
  });

  describe("when they turn it on for a From LangWatch board", () => {
    /** @scenario "A From LangWatch board can be turned on" */
    it("reads on, with the template's name as it was sent", async () => {
      const { as, daily } = await project();
      const member = as({ userId: MEMBER });
      const scope = { projectId: PROJECT, board: { kind: TEMPLATE.kind, id: TEMPLATE.id } };

      await member.configureBoardDailyRun({ ...ON, board: TEMPLATE, maxInsights: 1 });

      expect(await member.getBoardDailyRun(scope)).toMatchObject({
        state: "on",
        settings: { maxInsights: 1 },
      });
      // The stored board with the same id is another schedule, still undecided.
      expect(
        await member.getBoardDailyRun({ ...scope, board: { kind: "dashboard", id: TEMPLATE.id } }),
      ).toEqual(UNDECIDED);
      expect(daily.boardReads).toEqual([]);
    });
  });

  describe("when they send a setting a schedule does not take", () => {
    /** @scenario "A setting a schedule does not take is refused" */
    it.each<[string, { hour?: number; timezone?: string }]>([
      ["an hour of 24", { hour: 24 }],
      ["half an hour", { hour: 9.5 }],
      ["a zone no one knows", { timezone: "Mars/Olympus_Mons" }],
      ["an offset in place of a zone", { timezone: "+02:00" }],
    ])("refuses %s before the module is asked, and records nothing", async (_what, bad) => {
      const { as, daily } = await project();
      const member = as({ userId: MEMBER });

      await expect(
        member.configureBoardDailyRun({ ...ON, maxInsights: 3, ...bad }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(await daily.runEventsOf()).toEqual([]);
      expect(await member.getBoardDailyRun(SCOPE)).toEqual(UNDECIDED);
    });
  });
});

describe("given a member turned their daily run on for a board", () => {
  describe("when another member of the project reads and sets the same board", () => {
    /** @scenario "A member reads and writes only their own daily run setting" */
    it("answers the other member their own setting, and changes nothing of the first", async () => {
      const { as, daily } = await project();
      const member = as({ userId: MEMBER });
      const other = as({ userId: OTHER_MEMBER });
      await member.configureBoardDailyRun({ ...ON, maxInsights: 3 });

      const theirsBefore = await other.getBoardDailyRun(SCOPE);
      await other.turnOffBoardDailyRun(OFF);
      await other.configureBoardDailyRun({ ...ON, hour: 23, maxInsights: 1 });
      await other.turnOffBoardDailyRun(OFF);

      expect(theirsBefore).toEqual(UNDECIDED);
      expect(await other.getBoardDailyRun(SCOPE)).toMatchObject({
        state: "off",
        settings: { hour: 23, maxInsights: 1 },
      });
      expect(await member.getBoardDailyRun(SCOPE)).toEqual({
        state: "on",
        settings: { hour: 9, timezone: "Europe/Amsterdam", maxInsights: 3 },
        lastRun: null,
        offReason: null,
        runInFlight: null,
      });
      expect(await daily.runEventsOf({ userId: MEMBER })).toEqual([CONFIGURED]);
    });
  });
});

describe("given a board its author keeps as Only me", () => {
  /** @scenario "Another member's Only me board cannot be turned on, and answers as a board that is not there" */
  it("refuses another member as it refuses a board that never existed, and lets the author", async () => {
    const { as, daily } = await project();
    daily.world.boards.set(PRIVATE_BOARD.id, {
      name: "Mine",
      widgets: [],
      scope: "PRIVATE",
      createdById: MEMBER,
    });
    const other = as({ userId: OTHER_MEMBER });
    const unknown = { ...PRIVATE_BOARD, id: "dashboard-unknown" };

    const theirs = await refusalOf(
      other.configureBoardDailyRun({ ...ON, board: PRIVATE_BOARD, maxInsights: 3 }),
    );
    const none = await refusalOf(
      other.configureBoardDailyRun({ ...ON, board: unknown, maxInsights: 3 }),
    );
    await as({ userId: MEMBER }).configureBoardDailyRun({
      ...ON,
      board: PRIVATE_BOARD,
      maxInsights: 3,
    });

    expect(none).toMatchObject({
      code: "NOT_FOUND",
      cause: { code: "dashboard_not_found", httpStatus: 404 },
    });
    expect(theirs).toEqual(none);
    expect(await daily.runEventsOf({ userId: OTHER_MEMBER, board: PRIVATE_BOARD })).toEqual([]);
    expect(await daily.runEventsOf({ userId: MEMBER, board: PRIVATE_BOARD })).toEqual([CONFIGURED]);
  });
});

describe("given the release_insights flag is off for the project", () => {
  /** @scenario "A daily run setting is refused while the flag is off" */
  it("refuses the read and both writes with insights_not_enabled, and records nothing", async () => {
    const { as, daily } = await project({ isEnabled: false });
    const member = as({ userId: MEMBER });

    const requests = [
      member.getBoardDailyRun(SCOPE),
      member.configureBoardDailyRun({ ...ON, maxInsights: 3 }),
      member.turnOffBoardDailyRun(OFF),
    ];

    for (const request of requests) {
      await expect(request).rejects.toMatchObject({ cause: { code: "insights_not_enabled" } });
    }
    expect(await daily.runEventsOf()).toEqual([]);
    expect(daily.boardReads).toEqual([]);
  });
});

describe("given an organisation admin on an aggregate project", () => {
  /** @scenario "An aggregate project takes no daily run setting" */
  it("refuses turning it on and off as read only, before the module is asked", async () => {
    const { as, daily } = await project();
    const admin = as({ userId: MEMBER, isOnAggregate: true });

    const writes = [
      admin.configureBoardDailyRun({ ...ON, maxInsights: 3 }),
      admin.turnOffBoardDailyRun(OFF),
    ];

    for (const write of writes) {
      await expect(write).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "aggregate_project_is_read_only" },
      });
    }
    expect(daily.gateAsks).toEqual([]);
    expect(await daily.runEventsOf()).toEqual([]);
    // A read is no write: it answers that nothing was decided there.
    await expect(admin.getBoardDailyRun(SCOPE)).resolves.toEqual(UNDECIDED);
  });
});

describe("given a member without analytics:view", () => {
  /** @scenario "A member without analytics:view cannot read or set a daily run" */
  it("refuses the read and both writes as forbidden, before the handler runs", async () => {
    const { as, daily } = await project();
    const outsider = as({ userId: MEMBER, held: [] });

    const requests = [
      outsider.getBoardDailyRun(SCOPE),
      outsider.configureBoardDailyRun({ ...ON, maxInsights: 3 }),
      outsider.turnOffBoardDailyRun(OFF),
    ];

    for (const request of requests) {
      await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(daily.gateAsks).toEqual([]);
    expect(await daily.runEventsOf()).toEqual([]);
  });
});

describe("given a member with analytics:view and without langy:create", () => {
  /** @scenario "A member without langy:create cannot turn a daily run on" */
  it("refuses turning it on as forbidden, and still answers the read and turning it off", async () => {
    const { as, daily } = await project();
    const viewer = as({ userId: MEMBER, held: VIEW });

    await expect(viewer.configureBoardDailyRun({ ...ON, maxInsights: 3 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await viewer.getBoardDailyRun(SCOPE)).toEqual(UNDECIDED);
    await viewer.turnOffBoardDailyRun(OFF);
    expect(await viewer.getBoardDailyRun(SCOPE)).toMatchObject({ state: "off" });
    expect(await daily.runEventsOf()).toEqual([TURNED_OFF]);
  });
});

/** A Langy turn that waits to settle until the test lets it, with an answer that finds nothing. */
function heldTurn(daily: InstalledDailyRuns) {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  daily.world.langy.settle = async (input): Promise<LangyTurnSettlementWait> => {
    await released;
    const parts = stampedParts(answerWith([]));
    return {
      kind: "settled",
      settlement: {
        succeeded: true,
        outcome: "completed",
        text: extractLangyTextFromParts(parts),
        messageId: `message-of-${input.turnId}`,
        parts,
        error: null,
      },
    };
  };
  return { release };
}

/** Carries out the run the schedule's process wrote for a request, as the outbox does. */
async function carryOutRequest(daily: InstalledDailyRuns, requestId: string) {
  const intent = (await daily.intentsOf()).find(
    ({ payload }) => (payload as { runId?: string }).runId === requestId,
  );
  if (!intent) throw new Error(`The schedule wrote no intent for request ${requestId}`);
  return daily.carryOut(intent.payload);
}

describe("given a member with analytics:view and langy:create, and a board that is on", () => {
  describe("when they run the board now", () => {
    /** @scenario "Run now asks for a run and opens Langy on it" */
    it("requests a run for them, names its conversation while it runs, and none once it settled", async () => {
      const { as, daily } = await project();
      const member = as({ userId: MEMBER });
      await member.configureBoardDailyRun({ ...ON, maxInsights: 3 });
      const { release } = heldTurn(daily);

      const { requestId } = await member.runBoardDailyRunNow(RUN_NOW);
      const running = carryOutRequest(daily, requestId);
      await vi.waitFor(async () => expect(await daily.runEventsOf()).toContain(RUN_STARTED));
      const during = await member.getBoardDailyRun(SCOPE);
      release();
      await running;

      expect(requestId).toEqual(expect.any(String));
      expect(during.runInFlight).toEqual({
        conversationId: "conversation-1",
        startedAt: expect.any(Number),
      });
      expect(daily.langy.starts).toEqual([expect.objectContaining({ userId: MEMBER })]);
      expect(await member.getBoardDailyRun(SCOPE)).toMatchObject({
        runInFlight: null,
        lastRun: { outcome: "nothing", conversationId: "conversation-1" },
      });
      expect(await daily.runEventsOf()).toEqual([
        CONFIGURED,
        RUN_REQUESTED,
        RUN_STARTED,
        RUN_SETTLED,
      ]);
    });

    it("names no run in flight once it started longer ago than a run may take", async () => {
      const { as, daily } = await project();
      const member = as({ userId: MEMBER });
      const { release } = heldTurn(daily);
      const { requestId } = await member.runBoardDailyRunNow(RUN_NOW);
      const running = carryOutRequest(daily, requestId);
      await vi.waitFor(async () => expect(await daily.runEventsOf()).toContain(RUN_STARTED));

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(Date.now() + INSIGHT_DAILY_RUN_EXPIRY_MS);
        expect((await member.getBoardDailyRun(SCOPE)).runInFlight).toBeNull();
      } finally {
        vi.useRealTimers();
        release();
        await running;
      }
    });
  });
});

describe("given a member without analytics:view or without langy:create", () => {
  /** @scenario "Run now asks for analytics:view and langy:create" */
  it.each([
    ["without analytics:view", ["langy:create"]],
    ["without langy:create", VIEW],
  ])("refuses running a board now %s as forbidden, and requests no run", async (_what, held) => {
    const { as, daily } = await project();

    await expect(as({ userId: MEMBER, held }).runBoardDailyRunNow(RUN_NOW)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(await daily.runEventsOf()).toEqual([]);
  });
});

describe("given an aggregate project, or a project with release_insights off", () => {
  /** @scenario "Run now is refused on an aggregate project, and with the flag off" */
  it("refuses running a board now on an aggregate as read only, and requests no run", async () => {
    const { as, daily } = await project();

    await expect(
      as({ userId: MEMBER, isOnAggregate: true }).runBoardDailyRunNow(RUN_NOW),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: { code: "aggregate_project_is_read_only" },
    });

    expect(await daily.runEventsOf()).toEqual([]);
  });

  /** @scenario "Run now is refused on an aggregate project, and with the flag off" */
  it("refuses running a board now with the flag off, and requests no run", async () => {
    const { as, daily } = await project({ isEnabled: false });

    await expect(as({ userId: MEMBER }).runBoardDailyRunNow(RUN_NOW)).rejects.toMatchObject({
      cause: { code: "insights_not_enabled" },
    });

    expect(await daily.runEventsOf()).toEqual([]);
  });
});
