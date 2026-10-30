/**
 * @vitest-environment node
 * `insights.runAction` on the real tRPC runtime over the installed module: who the door lets
 * click, and that the turn runs as the person the session proved. Only the authorisation
 * answer, the session person and Langy are the test's.
 * @see modules/insight/specs/insight-actions.feature
 */

import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  TrpcRootDefinition,
} from "@langwatch/api/trpc";
import {
  LANGY_CONVERSATION_ORIGIN,
  type LangyApi,
  type LangyPanelCaller,
} from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { nowInstant } from "@langwatch/time";
import { afterEach, describe, expect, it } from "vitest";

import {
  filing,
  installInsight,
  type InstalledInsight,
  PROJECT,
} from "../../app/__tests__/insight.fixture.ts";
import { insightSessionPersonContext, insightTrpcTransport } from "../insight.trpc.ts";

type TestContext = { actor: { id: string } };

const OWNER = "user-owner";
const PERSON = { name: "Ada Owner", email: "ada@example.com" };
const SOURCE = { conversationId: "conversation-own", messageId: "message-1" };
const ACTION = { label: "Find the traces", prompt: "Find the failing checkout traces." };

let installed: InstalledInsight | undefined;

afterEach(async () => {
  await installed?.stop();
  installed = undefined;
});

/** The module over a Langy that holds the owner's conversation and records who each turn is for. */
async function project() {
  const callers: LangyPanelCaller[] = [];
  const langy = createApiFixture<LangyApi>({
    findByIdVisible: async ({ id }) => ({
      id,
      title: null,
      isShared: false,
      isOwn: true,
      origin: LANGY_CONVERSATION_ORIGIN.INTERACTIVE,
      lastActivityAt: nowInstant(),
      messageCount: 2,
      status: "idle",
      currentTurnId: null,
      lastError: null,
      lastModel: null,
      eventCursor: null,
    }),
    continueConversationTurn: async ({ conversationId, caller }) => {
      callers.push(caller);
      return { conversationId, turnId: "turn-1" };
    },
  });
  const insight = await installInsight({ peers: { langy } });
  installed = insight;
  const { id } = await insight.app.fileInsight({
    ...filing({ source: SOURCE, actions: [ACTION] }),
    userId: OWNER,
  });

  const as = ({ held }: { held: readonly string[] }) => {
    const trpc = TrpcRootDefinition.forContext<TestContext>().create();
    return createTrpcRuntime<TestContext>({
      root: trpc,
      procedure: trpc.procedure,
      members: trpcTestMembers<TestContext>({ permits: (permission) => held.includes(permission) }),
    })
      .mount(insightTrpcTransport, () => insight.app, {
        middlewareContext: [
          bindTrpcMiddlewareContext(insightSessionPersonContext, (_ctx: TestContext) => PERSON),
        ],
      })
      .createCaller({ actor: { id: OWNER } });
  };
  const click = { projectId: PROJECT, insightId: id, actionId: "a0", clickId: "click-0001" };

  return { as, click, callers };
}

describe("given a member with analytics:view and no langy:create", () => {
  describe("when they run an action on their insight", () => {
    /** @scenario "A click without langy:create is refused before the handler runs" */
    it("refuses as forbidden before the handler runs, and sends Langy nothing", async () => {
      const { as, click, callers } = await project();

      await expect(as({ held: ["analytics:view"] }).runAction(click)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(callers).toEqual([]);
    });
  });
});

describe("given a member with analytics:view and langy:create", () => {
  describe("when they run an action on their insight", () => {
    it("starts the turn as the person the session proved", async () => {
      const { as, click, callers } = await project();

      const run = await as({ held: ["analytics:view", "langy:create"] }).runAction(click);

      expect(run).toEqual({
        conversationId: "conversation-own",
        turnId: "turn-1",
        sourceGone: false,
      });
      expect(callers).toEqual([{ userId: OWNER, ...PERSON }]);
    });
  });
});
