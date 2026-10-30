/**
 * @vitest-environment node
 * An insight's actions on the installed module: what a filing keeps, and what a click sends
 * Langy and where. Langy is a fake that holds conversations and takes one message per key.
 * @see modules/insight/specs/insight-actions.feature
 */

import { INSIGHT_ACTIONS_FLAG, type InsightActionInput } from "@langwatch/insight-contract";
import {
  LANGY_CONVERSATION_ORIGIN,
  type LangyApi,
  type LangyConversationOrigin,
} from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { afterEach, describe, expect, it } from "vitest";

import {
  filing,
  installInsight,
  type InstalledInsight,
  OTHER_PROJECT,
  PROJECT,
} from "./insight.fixture.ts";

const OWNER = "user-owner";
const CALLER = { userId: OWNER, name: "Ada Owner", email: "ada@example.com" };
const TITLE = "Checkout errors doubled";
const FIND_TRACES: InsightActionInput = {
  label: "Find the traces",
  prompt: "Find the failing checkout traces from the last day.",
};
const DRAFT_EVALUATOR: InsightActionInput = {
  label: "Draft an evaluator",
  prompt: "Draft an evaluator that flags a failed checkout.",
};

type HeldConversation = { isOwn: boolean; origin: LangyConversationOrigin };
type SentMessage = {
  via: "create" | "continue";
  conversationId: string | null;
  idempotencyKey: string;
  userId: string;
  text: string;
};

/** Langy as a click meets it: the conversations it holds, and one message per idempotency key. */
function fakeLangy() {
  const conversations = new Map<string, HeldConversation>();
  const sent: SentMessage[] = [];
  const forked: string[] = [];
  const turns = new Map<string, { conversationId: string; turnId: string }>();

  const start = ({
    via,
    input,
  }: {
    via: SentMessage["via"];
    input: Parameters<LangyApi["createConversationTurn"]>[0];
  }) => {
    const key = input.idempotencyKey ?? "";
    const known = turns.get(key);
    if (known) return Promise.resolve(known);
    const conversationId = input.conversationId ?? `conversation-new-${turns.size + 1}`;
    const turn = { conversationId, turnId: `turn-${turns.size + 1}` };
    turns.set(key, turn);
    const part = input.messages.at(-1)?.parts[0];
    sent.push({
      via,
      conversationId: input.conversationId ?? null,
      idempotencyKey: key,
      userId: input.caller.userId,
      text: typeof part?.text === "string" ? part.text : "",
    });
    return Promise.resolve(turn);
  };

  const detail = (id: string, held: HeldConversation) => ({
    id,
    title: null,
    isShared: !held.isOwn,
    isOwn: held.isOwn,
    origin: held.origin,
    lastActivityAt: nowInstant(),
    messageCount: 2,
    status: "idle",
    currentTurnId: null,
    lastError: null,
    lastModel: null,
    eventCursor: null,
  });

  const api = createApiFixture<LangyApi>({
    findByIdVisible: async ({ id }) => {
      const held = conversations.get(id);
      return held ? detail(id, held) : null;
    },
    forkConversation: async ({ conversationId }) => {
      forked.push(conversationId);
      const id = `fork-${forked.length}`;
      conversations.set(id, { isOwn: true, origin: LANGY_CONVERSATION_ORIGIN.INTERACTIVE });
      return {
        id,
        title: null,
        isShared: false,
        isOwn: true,
        origin: LANGY_CONVERSATION_ORIGIN.INTERACTIVE,
        messageCount: 2,
        lastActivityAtMs: 0,
        status: "idle" as const,
      };
    },
    createConversationTurn: (input) => start({ via: "create", input }),
    continueConversationTurn: (input) => start({ via: "continue", input }),
  });

  return { api, conversations, sent, forked };
}

let installed: InstalledInsight | undefined;

afterEach(async () => {
  await installed?.stop();
  installed = undefined;
});

/** The module over the fake Langy, with conversations it already holds. */
async function setUp({
  held = {},
  isEnabled = true,
}: {
  held?: Record<string, HeldConversation>;
  isEnabled?: boolean | ((flag: string) => boolean);
} = {}) {
  const langy = fakeLangy();
  for (const [id, conversation] of Object.entries(held)) langy.conversations.set(id, conversation);
  const insight = await installInsight({ isEnabled, peers: { langy: langy.api } });
  installed = insight;
  const { app } = insight;

  const file = ({
    actions = [FIND_TRACES],
    conversationId,
    projectId = PROJECT,
  }: {
    actions?: InsightActionInput[];
    conversationId?: string;
    projectId?: string;
  } = {}) =>
    app.fileInsight({
      ...filing({
        projectId,
        title: TITLE,
        lwql: "SELECT count() FROM traces",
        replay: {
          start: Date.UTC(2026, 9, 27),
          end: Date.UTC(2026, 9, 28),
          granularitySeconds: 3_600,
          period: null,
          parameters: {},
        },
        actions,
        ...(conversationId ? { source: { conversationId, messageId: "message-1" } } : {}),
      }),
      userId: OWNER,
    });

  const click = ({
    insightId,
    actionId = "a0",
    clickId = "click-0001",
    projectId = PROJECT,
  }: {
    insightId: string;
    actionId?: string;
    clickId?: string;
    projectId?: string;
  }) => app.runInsightAction({ projectId, insightId, actionId, clickId, ...CALLER });

  return { app, langy, file, click, insight };
}

const OWN = { isOwn: true, origin: LANGY_CONVERSATION_ORIGIN.INTERACTIVE };
const SHARED = { isOwn: false, origin: LANGY_CONVERSATION_ORIGIN.INTERACTIVE };
const RUN = { isOwn: true, origin: LANGY_CONVERSATION_ORIGIN.RUN };

describe("given a member saves a Langy answer with actions", () => {
  describe("when they read their inbox", () => {
    /** @scenario "A filing names its actions by position" */
    it("holds the actions, named by position", async () => {
      const { app, file } = await setUp({ held: { "conversation-own": OWN } });

      await file({ actions: [FIND_TRACES, DRAFT_EVALUATOR], conversationId: "conversation-own" });

      const [entry] = await app.findInsights({ projectId: PROJECT, userId: OWNER });
      expect(entry?.actions).toEqual([
        { id: "a0", ...FIND_TRACES },
        { id: "a1", ...DRAFT_EVALUATOR },
      ]);
    });
  });

  describe("when the answer came from a conversation a run started", () => {
    /** @scenario "An answer saved from a run's conversation keeps no actions" */
    it("files the insight with no actions", async () => {
      const { app, file } = await setUp({ held: { "conversation-run": RUN } });

      const filed = await file({ conversationId: "conversation-run" });

      const [entry] = await app.findInsights({ projectId: PROJECT, userId: OWNER });
      expect(filed.actions).toEqual([]);
      expect(entry?.actions).toEqual([]);
    });
  });
});

describe("given an insight with an action, saved from its owner's conversation", () => {
  describe("when its owner clicks the action", () => {
    /** @scenario "A click sends Langy the stored prompt after a fixed framing line" */
    it("sends Langy the stored prompt text exactly, after the framing line", async () => {
      const { langy, file, click } = await setUp({ held: { "conversation-own": OWN } });
      const { id } = await file({ conversationId: "conversation-own" });

      await click({ insightId: id });

      expect(langy.sent.map((message) => message.text)).toEqual([
        `You clicked this action on the insight "${TITLE}":\n\n${FIND_TRACES.prompt}`,
      ]);
    });

    /** @scenario "The owner's click continues the conversation the insight came from" */
    it("continues that conversation as the owner, and forks nothing", async () => {
      const { langy, file, click } = await setUp({ held: { "conversation-own": OWN } });
      const { id } = await file({ conversationId: "conversation-own" });

      const run = await click({ insightId: id });

      expect(run).toEqual({
        conversationId: "conversation-own",
        turnId: "turn-1",
        sourceGone: false,
      });
      expect(langy.sent).toEqual([
        expect.objectContaining({
          via: "continue",
          conversationId: "conversation-own",
          userId: OWNER,
        }),
      ]);
      expect(langy.forked).toEqual([]);
    });
  });

  describe("when the same click reaches the module twice", () => {
    /** @scenario "The same click sent twice sends Langy one message" */
    it("sends both with the same idempotency key, and Langy takes one message", async () => {
      const { langy, file, click } = await setUp({ held: { "conversation-own": OWN } });
      const { id } = await file({ conversationId: "conversation-own" });

      const first = await click({ insightId: id, clickId: "click-0001" });
      const again = await click({ insightId: id, clickId: "click-0001" });

      expect(again).toEqual(first);
      expect(langy.sent.map((message) => message.idempotencyKey)).toEqual([
        `insight-action:${id}:a0:click-0001`,
      ]);
    });
  });
});

describe("given an insight saved from a conversation another person shared", () => {
  describe("when its owner clicks an action", () => {
    /** @scenario "A click on an insight saved from another person's conversation continues a fork" */
    it("forks the conversation for them, and continues the fork", async () => {
      const { langy, file, click } = await setUp({ held: { "conversation-shared": SHARED } });
      const { id } = await file({ conversationId: "conversation-shared" });

      const run = await click({ insightId: id });

      expect(langy.forked).toEqual(["conversation-shared"]);
      expect(langy.sent).toEqual([
        expect.objectContaining({ via: "continue", conversationId: "fork-1", userId: OWNER }),
      ]);
      expect(run).toMatchObject({ conversationId: "fork-1", sourceGone: false });
    });
  });
});

describe("given an insight whose source conversation is gone", () => {
  describe("when its owner clicks an action", () => {
    /** @scenario "A click whose source conversation is gone starts a new seeded conversation" */
    it("starts a new conversation that opens with the insight, and says the source is gone", async () => {
      const { langy, file, click } = await setUp();
      const { id } = await file({ conversationId: "conversation-archived" });

      const run = await click({ insightId: id });

      expect(run).toMatchObject({ conversationId: "conversation-new-1", sourceGone: true });
      expect(langy.forked).toEqual([]);
      expect(langy.sent).toEqual([
        expect.objectContaining({ via: "create", conversationId: null, userId: OWNER }),
      ]);
      expect(langy.sent[0]?.text).toBe(
        [
          `This conversation starts from the insight "${TITLE}":`,
          "",
          "Checkout errors doubled overnight.",
          "",
          "Its query: SELECT count() FROM traces",
          "Its window: from 2026-10-27T00:00:00Z to 2026-10-28T00:00:00Z",
          "",
          `You clicked this action on the insight "${TITLE}":`,
          "",
          FIND_TRACES.prompt,
        ].join("\n"),
      );
    });
  });
});

describe("given two insights of one owner, each with its own actions", () => {
  describe("when the owner runs an action id of the second on the first", () => {
    /** @scenario "An action id another insight holds is not found on this one" */
    it("refuses an actionId that belongs to another insight", async () => {
      const { langy, file, click } = await setUp({ held: { "conversation-own": OWN } });
      const first = await file({ conversationId: "conversation-own" });
      await file({ actions: [FIND_TRACES, DRAFT_EVALUATOR], conversationId: "conversation-own" });

      await expect(click({ insightId: first.id, actionId: "a1" })).rejects.toMatchObject({
        code: "insight_action_not_found",
      });
      expect(langy.sent).toEqual([]);
    });
  });
});

describe("given an insight filed in another project", () => {
  describe("when its owner runs one of its actions in this project", () => {
    /** @scenario "An insight in another project is not found" */
    it("refuses an insight from another project", async () => {
      const { langy, file, click } = await setUp({ held: { "conversation-own": OWN } });
      const elsewhere = await file({
        conversationId: "conversation-own",
        projectId: OTHER_PROJECT,
      });

      await expect(click({ insightId: elsewhere.id, projectId: PROJECT })).rejects.toMatchObject({
        code: "insight_not_found",
      });
      expect(langy.sent).toEqual([]);
    });
  });
});

describe("given an insight a daily run filed", () => {
  describe("when its owner runs an action on it", () => {
    /** @scenario "An action on an insight a run filed is refused" */
    it("refuses with insight_action_from_run, and sends Langy nothing", async () => {
      const { langy, click, insight } = await setUp();
      const insightId = await insight.fileByRun({ ownerUserId: OWNER });

      await expect(click({ insightId })).rejects.toMatchObject({ code: "insight_action_from_run" });
      expect(langy.sent).toEqual([]);
    });
  });
});

describe("given an insight with actions whose source conversation a run started", () => {
  describe("when its owner clicks an action", () => {
    /** @scenario "An action whose source conversation is a run's is refused" */
    it("refuses with insight_action_from_run, and sends Langy nothing", async () => {
      // Not visible when the answer was saved, so the filing kept its actions.
      const { langy, file, click } = await setUp();
      const { id } = await file({ conversationId: "conversation-later" });
      langy.conversations.set("conversation-later", RUN);

      await expect(click({ insightId: id })).rejects.toMatchObject({
        code: "insight_action_from_run",
      });
      expect(langy.sent).toEqual([]);
    });
  });
});

describe("given the release_insight_actions flag is off for the project", () => {
  describe("when an owner clicks an action", () => {
    /** @scenario "A click while release_insight_actions is off is refused" */
    it("refuses with insight_actions_not_enabled, and sends Langy nothing", async () => {
      let actionsOn = true;
      const { langy, file, click } = await setUp({
        held: { "conversation-own": OWN },
        isEnabled: (flag) => flag !== INSIGHT_ACTIONS_FLAG || actionsOn,
      });
      const { id } = await file({ conversationId: "conversation-own" });
      actionsOn = false;

      await expect(click({ insightId: id })).rejects.toMatchObject({
        code: "insight_actions_not_enabled",
      });
      expect(langy.sent).toEqual([]);
    });
  });
});
