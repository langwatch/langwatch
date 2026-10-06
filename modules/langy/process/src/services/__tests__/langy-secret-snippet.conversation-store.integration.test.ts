/**
 * A turn that shows a secret through the secret_snippet card, recorded by the real turn
 * service through the real command handlers and folded by the real projections.
 * @vitest-environment node
 * @see specs/langy/langy-secret-snippet.feature
 */
import { createTenantId, orderEvents, type StateProjectionStore } from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
} from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { processingEvent } from "../../eventing/__tests__/support/langy-processing-events.ts";
import {
  type LangyConversationProcessingEvent,
  LangyConversationStateFoldProjection,
} from "../../eventing/langy-conversation-state.projection.ts";
import { LangyConversationTurnFoldProjection } from "../../eventing/langy-conversation-turn.projection.ts";
import type { LangyConversationCommands } from "../../eventing/langy-conversation.commands.ts";
import {
  AcceptAgentTurnCommand,
  InitiateToolCallCommand,
  RecordAgentResponseCommand,
  SucceedToolCallCommand,
} from "../../eventing/langy-conversation.intent.ts";
import { LangyConversationTurnService } from "../langy-conversation-turn.service.ts";
import { LangyFinalPartsService } from "../langy-final-parts.service.ts";

const PROJECT = "project-1";
const CONVERSATION = "conv-secret";
const TURN = "turn-1";
const TOOL_CALL = "tc-1";
const REVEAL_ID = "rvl_content_marker";
const PREVIEW = "vk-lw-preview";
const TEMPLATE = 'export OPENAI_API_KEY="{{secret}}"';
/** The value the card would show; the model never holds it, so no frame carries it. */
const SECRET = `vk-lw-${"content-marker".repeat(2)}`;
const SNIPPET_INPUT = { revealId: REVEAL_ID, template: TEMPLATE, preview: PREVIEW };
const SNIPPET_ANSWER =
  "The secret snippet card is shown to the user, with the key filled in. Never print the key yourself.";

const stateStore: StateProjectionStore<LangyConversationStateData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};
const turnStore: StateProjectionStore<LangyConversationTurnData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};

/** The turn service over command handlers that keep the events they emit. */
function recordingService() {
  const events: LangyConversationProcessingEvent[] = [];
  const handle = async (
    handler: { handle(command: never): unknown },
    data: { tenantId: string },
  ) => {
    const emitted = (await handler.handle({
      tenantId: createTenantId(data.tenantId),
      data,
    } as never)) as readonly unknown[];
    for (const event of emitted) events.push(processingEvent(event));
  };
  const commands = createApiFixture<LangyConversationCommands>({
    acceptAgentTurn: (data) => handle(new AcceptAgentTurnCommand(), data),
    initiateToolCall: (data) => handle(new InitiateToolCallCommand(), data),
    succeedToolCall: (data) => handle(new SucceedToolCallCommand(), data),
    recordAgentResponse: (data) => handle(new RecordAgentResponseCommand(), data),
  });
  let tick = 1_000;
  const service = LangyConversationTurnService.create({
    repository: createApiFixture({}),
    commands,
    finalParts: LangyFinalPartsService.create(),
    runtime: {
      now: () => (tick += 100),
      generateId: () => "generated",
      createTurnId: () => TURN,
    },
    turnOrder: null,
  });

  return { service, events };
}

describe("the conversation store after a secret snippet turn", () => {
  describe("given a turn where Langy showed a secret through the secret_snippet card", () => {
    /** @scenario "The secret is never in the conversation store" */
    it("stores the reveal id, the template and the prefix, and never the secret", async () => {
      const { service, events } = recordingService();
      await service.acceptTurn({
        projectId: PROJECT,
        conversationId: CONVERSATION,
        turnId: TURN,
        conversationStart: { userId: "alice", title: "Guided onboarding", runToken: "run-token" },
        userMessage: {
          userId: "alice",
          messageId: "m1",
          role: "user",
          parts: [{ type: "text", text: "Set up the gateway" }],
          title: "Guided onboarding",
        },
      });
      await service.recordToolCallStarted({
        projectId: PROJECT,
        conversationId: CONVERSATION,
        turnId: TURN,
        toolCallId: TOOL_CALL,
        toolName: "secret_snippet",
        input: SNIPPET_INPUT,
      });
      await service.recordToolCallCompleted({
        projectId: PROJECT,
        conversationId: CONVERSATION,
        turnId: TURN,
        toolCallId: TOOL_CALL,
        toolName: "secret_snippet",
        input: SNIPPET_INPUT,
        durationMs: 5,
      });
      await service.ingestAgentTurnResult({
        projectId: PROJECT,
        conversationId: CONVERSATION,
        turnId: TURN,
        status: "completed",
        text: "Your key is live. Point your app at the gateway with it.",
        toolCalls: [
          { id: TOOL_CALL, name: "secret_snippet", input: SNIPPET_INPUT, output: SNIPPET_ANSWER },
        ],
      });

      const ordered = orderEvents(events);
      const state = ordered.reduce(
        (acc, next) =>
          new LangyConversationStateFoldProjection({ store: stateStore }).apply(acc, next),
        new LangyConversationStateFoldProjection({ store: stateStore }).init(),
      );
      const turn = ordered.reduce(
        (acc, next) =>
          new LangyConversationTurnFoldProjection({ store: turnStore }).apply(acc, next),
        new LangyConversationTurnFoldProjection({ store: turnStore }).init(),
      );
      const stored = JSON.stringify(ordered);

      expect(ordered.length).toBeGreaterThanOrEqual(5);
      expect(stored).toContain("tool-secret_snippet");
      expect(stored).toContain(REVEAL_ID);
      expect(stored).toContain("{{secret}}");
      expect(stored).toContain(PREVIEW);
      expect(stored).not.toContain(SECRET);
      expect(JSON.stringify(state)).not.toContain(SECRET);
      expect(JSON.stringify(turn)).not.toContain(SECRET);
      expect(turn.ToolCalls[0]).toMatchObject({
        toolCallId: TOOL_CALL,
        toolName: "secret_snippet",
      });
      const initiated = ordered.find((event) => event.type.endsWith("tool_call_initiated"));
      const input = (initiated?.data as { input?: object } | undefined)?.input ?? {};
      expect(Object.keys(input).toSorted()).toEqual(["preview", "revealId", "template"]);
    });
  });
});
