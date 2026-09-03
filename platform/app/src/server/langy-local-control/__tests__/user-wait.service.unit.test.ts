/**
 * The user wait, the one primitive behind the permission card and the question
 * card, over the in-memory store. The durable events and the live entries are
 * both recorded by stand-ins, so what each move writes is visible without a
 * pipeline and without Redis.
 *
 * @see specs/langy/langy-local-permissions.feature
 * @see specs/langy/langy-choice-questions.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentStateStore,
  createMemoryStateStore,
} from "~/server/connected-agents/state-store";
import {
  LIVE_STREAM_KEEPALIVE_MS,
  PERMISSION_WAIT_BUDGET_MS,
  QUESTION_WAIT_BUDGET_MS,
} from "../constants";
import {
  type UserWaitBuffer,
  type UserWaitEvents,
  UserWaitService,
} from "../user-wait.service";

const projectId = "proj_1";
const conversationId = "conv_1";
const turnId = "turn_1";
const userId = "user_1";

let now = 1_700_000_000_000;
let store: AgentStateStore;
let events: UserWaitEvents & {
  started: unknown[];
  ended: unknown[];
};
let buffer: UserWaitBuffer & {
  permissions: unknown[];
  questions: unknown[];
  statuses: unknown[];
};
let sendPermission: ReturnType<typeof vi.fn>;
let service: UserWaitService;

function recordingEvents() {
  const started: unknown[] = [];
  const ended: unknown[] = [];
  return {
    started,
    ended,
    async startUserWait(data: unknown) {
      started.push(data);
    },
    async endUserWait(data: unknown) {
      ended.push(data);
    },
  } as UserWaitEvents & { started: unknown[]; ended: unknown[] };
}

function recordingBuffer() {
  const permissions: unknown[] = [];
  const questions: unknown[] = [];
  const statuses: unknown[] = [];
  return {
    permissions,
    questions,
    statuses,
    async appendLocalPermission(args: { entry: unknown }) {
      permissions.push(args.entry);
    },
    async appendQuestion(args: { entry: unknown }) {
      questions.push(args.entry);
    },
    async appendStatus(args: unknown) {
      statuses.push(args);
    },
  } as UserWaitBuffer & {
    permissions: unknown[];
    questions: unknown[];
    statuses: unknown[];
  };
}

function startPermission() {
  return service.startPermission({
    projectId,
    conversationId,
    turnId,
    toolCallId: "toolu_1",
    callId: "lcall_1",
    summary: "pnpm typecheck",
    pattern: "pnpm *",
    reason: "The command is not on the read-only list.",
    skipOffered: true,
    workspaceName: "acme-app",
    hostname: "rogerio-mbp",
  });
}

function startQuestion() {
  return service.startQuestion({
    projectId,
    conversationId,
    turnId,
    toolCallId: "toolu_2",
    questions: [
      {
        question: "Which file should own the tracing setup?",
        options: [{ label: "main.py" }, { label: "app/tracing.py" }],
      },
    ],
  });
}

beforeEach(() => {
  now = 1_700_000_000_000;
  store = createMemoryStateStore({ now: () => now });
  events = recordingEvents();
  buffer = recordingBuffer();
  sendPermission = vi.fn(async () => undefined);
  service = new UserWaitService({
    store,
    events,
    buffer,
    sendPermission: sendPermission as never,
    now: () => now,
    pollIntervalMs: 1,
  });
});

describe("given a command that is not on the read-only list", () => {
  describe("when the command line asks for permission", () => {
    /** @scenario "A command outside the read-only set renders a permission card" */
    it("writes the durable card and puts it on the live edge", async () => {
      const wait = await startPermission();

      expect(wait.state).toBe("pending");
      expect(wait.expiresAt - wait.createdAt).toBe(PERMISSION_WAIT_BUDGET_MS);
      expect(events.started).toHaveLength(1);
      expect(events.started[0]).toMatchObject({
        kind: "permission",
        turnId,
        toolCallId: "toolu_1",
        permission: {
          callId: "lcall_1",
          summary: "pnpm typecheck",
          pattern: "pnpm *",
          workspaceName: "acme-app",
          hostname: "rogerio-mbp",
        },
      });
      expect(buffer.permissions[0]).toMatchObject({
        waitId: wait.waitId,
        status: "pending",
        summary: "pnpm typecheck",
      });
    });
  });

  describe("when the developer allows it once", () => {
    /** @scenario "Allowing once runs the command and returns its output" */
    it("records the answer and sends the decision to the folder", async () => {
      const wait = await startPermission();

      await service.answer({
        waitId: wait.waitId,
        userId,
        decision: "allow_once",
      });

      expect(sendPermission).toHaveBeenCalledWith({
        conversationId,
        callId: "lcall_1",
        decision: "allow_once",
      });
      expect(events.ended[0]).toMatchObject({
        outcome: "answered",
        decision: "allow_once",
        userId,
      });
    });

    /** @scenario "The answered card is recorded, so a reload shows the same outcome" */
    it("locks the card, so a later read of it reads answered", async () => {
      const wait = await startPermission();
      await service.answer({
        waitId: wait.waitId,
        userId,
        decision: "allow_once",
      });

      expect((await service.read(wait.waitId))?.state).toBe("answered");
      expect(buffer.permissions.at(-1)).toMatchObject({
        status: "answered",
        decision: "allow_once",
      });
    });
  });

  describe("when the developer denies it", () => {
    /** @scenario "Denying returns a pushback Langy acts on" */
    it("sends the denial, so the command never runs", async () => {
      const wait = await startPermission();

      await service.answer({ waitId: wait.waitId, userId, decision: "deny" });

      expect(sendPermission).toHaveBeenCalledWith({
        conversationId,
        callId: "lcall_1",
        decision: "deny",
      });
      expect(
        await service.poll({ waitId: wait.waitId, holdMs: 0 }),
      ).toMatchObject({ state: "answered" });
    });
  });

  describe("when nobody answers for the whole budget", () => {
    /** @scenario "A card left unanswered expires and Langy ends its turn in words" */
    it("expires the card and releases the call", async () => {
      const wait = await startPermission();
      now += PERMISSION_WAIT_BUDGET_MS + 1;

      const answer = await service.poll({ waitId: wait.waitId, holdMs: 0 });

      expect(answer).toMatchObject({ state: "expired" });
      expect(events.ended[0]).toMatchObject({ outcome: "expired" });
      expect(sendPermission).toHaveBeenCalledWith({
        conversationId,
        callId: "lcall_1",
        decision: "expired",
      });
    });

    /** @scenario "A late answer to an expired card does nothing" */
    it("refuses a late answer, so no command runs on it", async () => {
      const wait = await startPermission();
      now += PERMISSION_WAIT_BUDGET_MS + 1;
      await service.poll({ waitId: wait.waitId, holdMs: 0 });
      sendPermission.mockClear();

      await expect(
        service.answer({ waitId: wait.waitId, userId, decision: "allow_once" }),
      ).rejects.toMatchObject({ code: "langy_wait_expired" });
      expect(sendPermission).not.toHaveBeenCalled();
      expect(events.ended).toHaveLength(1);
    });
  });

  describe("when the wait runs past the keepalive interval", () => {
    /** @scenario "The live stream stays alive during a long wait" */
    it("appends one status entry per interval, which is what refreshes the stream", async () => {
      const wait = await startPermission();

      await service.poll({ waitId: wait.waitId, holdMs: 0 });
      expect(buffer.statuses).toHaveLength(0);

      now += LIVE_STREAM_KEEPALIVE_MS + 1;
      await service.poll({ waitId: wait.waitId, holdMs: 0 });
      expect(buffer.statuses).toHaveLength(1);

      now += LIVE_STREAM_KEEPALIVE_MS + 1;
      await service.poll({ waitId: wait.waitId, holdMs: 0 });
      expect(buffer.statuses).toHaveLength(2);
    });
  });
});

describe("given a question Langy asked mid-task", () => {
  describe("when the card renders", () => {
    /** @scenario "A question asked by the tool renders while the turn is in flight" */
    it("writes the durable card with its options and keeps the wait pending", async () => {
      const wait = await startQuestion();

      expect(wait.kind).toBe("question");
      expect(wait.expiresAt - wait.createdAt).toBe(QUESTION_WAIT_BUDGET_MS);
      expect(events.started[0]).toMatchObject({
        kind: "question",
        toolCallId: "toolu_2",
        questions: [
          {
            question: "Which file should own the tracing setup?",
            options: [{ label: "main.py" }, { label: "app/tracing.py" }],
          },
        ],
      });
      expect(
        await service.poll({ waitId: wait.waitId, holdMs: 0 }),
      ).toMatchObject({ state: "pending" });
    });
  });

  describe("when the developer picks an option", () => {
    /** @scenario "Selecting an option returns it to the tool and the turn continues" */
    it("returns the selection to the tool and locks the card", async () => {
      const wait = await startQuestion();

      await service.answer({
        waitId: wait.waitId,
        userId,
        answers: [
          {
            question: "Which file should own the tracing setup?",
            selected: ["app/tracing.py"],
          },
        ],
      });

      expect(
        await service.poll({ waitId: wait.waitId, holdMs: 0 }),
      ).toMatchObject({
        state: "answered",
        answers: [{ selected: ["app/tracing.py"] }],
      });
      expect(buffer.questions.at(-1)).toMatchObject({ status: "answered" });
    });

    /** @scenario "A free-text answer reaches the tool as words" */
    it("carries the developer's own words when they typed their own", async () => {
      const wait = await startQuestion();

      await service.answer({
        waitId: wait.waitId,
        userId,
        answers: [
          {
            question: "Which file should own the tracing setup?",
            selected: [],
            other: "src/observability/setup.ts",
          },
        ],
      });

      expect(
        await service.poll({ waitId: wait.waitId, holdMs: 0 }),
      ).toMatchObject({
        answers: [{ other: "src/observability/setup.ts" }],
      });
    });
  });

  describe("when nobody answers for the whole budget", () => {
    /** @scenario "A question no one answers ends the turn in words" */
    it("expires the card, so the tool answers that no answer arrived", async () => {
      const wait = await startQuestion();
      now += QUESTION_WAIT_BUDGET_MS + 1;

      expect(
        await service.poll({ waitId: wait.waitId, holdMs: 0 }),
      ).toMatchObject({ state: "expired" });
      expect(events.ended[0]).toMatchObject({
        kind: "question",
        outcome: "expired",
      });
    });
  });

  describe("when the turn is stopped", () => {
    /** @scenario "Stopping the turn closes the open question" */
    it("ends every card of that turn as cancelled, once", async () => {
      const question = await startQuestion();
      const permission = await startPermission();

      const cancelled = await service.cancelTurn({ conversationId, turnId });

      expect(cancelled.map((wait) => wait.waitId).sort()).toEqual(
        [question.waitId, permission.waitId].sort(),
      );
      expect(events.ended).toHaveLength(2);
      expect(events.ended[0]).toMatchObject({ outcome: "cancelled" });

      // The worker posts its own cancel from the abort signal, so the second
      // pass has to change nothing.
      expect(await service.cancelTurn({ conversationId, turnId })).toEqual([]);
      expect(events.ended).toHaveLength(2);
    });
  });
});
