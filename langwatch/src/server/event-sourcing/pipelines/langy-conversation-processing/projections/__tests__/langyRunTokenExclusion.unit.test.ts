/**
 * SECURITY invariant (LANGY_WORKER_REDESIGN_PLAN §0a): the per-conversation
 * `runToken` is the HMAC key that authenticates the worker's stream. It must
 * live ONLY on the server-only state column and must NEVER reach a client-facing
 * projection — above all the turn (render) document the browser reads.
 *
 * This pins the split: the state fold retains the token; the turn fold has no
 * field for it and never emits it, even across a full turn lifecycle. If someone
 * later threads the token into the render doc, this fails loudly.
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "../../schemas/constants";
import type { LangyConversationProcessingEvent } from "../../schemas/events";
import {
  LangyConversationStateFoldProjection,
  type LangyConversationStateData,
} from "../langyConversationState.foldProjection";
import {
  LangyConversationTurnFoldProjection,
  type LangyConversationTurnData,
} from "../langyConversationTurn.foldProjection";

const TENANT = createTenantId("project-1");
const CONVERSATION = "conv-1";
const TURN = "turn-1";
const RUN_TOKEN = "rt-super-secret-never-show-the-client";

function event(
  typeKey: keyof typeof LANGY_CONVERSATION_EVENT_TYPES,
  version: string,
  data: Record<string, unknown>,
  occurredAt: number,
): LangyConversationProcessingEvent {
  return {
    id: `event-${occurredAt}`,
    aggregateId: CONVERSATION,
    aggregateType: "langy_conversation",
    tenantId: TENANT,
    createdAt: occurredAt,
    occurredAt,
    type: LANGY_CONVERSATION_EVENT_TYPES[typeKey],
    version,
    data: { conversationId: CONVERSATION, ...data },
  } as unknown as LangyConversationProcessingEvent;
}

const stateStore: FoldProjectionStore<LangyConversationStateData> = {
  store: async () => {},
  get: async () => null,
};
const turnStore: FoldProjectionStore<LangyConversationTurnData> = {
  store: async () => {},
  get: async () => null,
};

const hasRunTokenKey = (o: object) =>
  Object.keys(o).some((k) => /run.?token/i.test(k));

describe("runToken projection exclusion", () => {
  describe("given a conversation created with a runToken", () => {
    const startedEvent = event(
      "CONVERSATION_STARTED",
      LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED,
      { userId: "alice", runToken: RUN_TOKEN },
      1000,
    );

    it("keeps the token on the server-only state fold", () => {
      const state = new LangyConversationStateFoldProjection({
        store: stateStore,
      });
      const doc = state.apply(state.init(), startedEvent);
      expect(doc.RunToken).toBe(RUN_TOKEN);
    });

    it("never lands the token on the turn (render) document, across a full turn", () => {
      const turn = new LangyConversationTurnFoldProjection({ store: turnStore });
      let doc = turn.init();
      // Drive the render doc through a realistic lifecycle. None of these carry
      // the runToken — the turn fold has no field for it — but assert on the
      // serialised doc so a future leak (a stray field, a spread of state) fails.
      for (const e of [
        event(
          "AGENT_RESPONSE_STARTED",
          LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_STARTED,
          { turnId: TURN },
          2000,
        ),
        event(
          "AGENT_RESPONDED",
          LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
          {
            turnId: TURN,
            messageId: "m1",
            role: "assistant",
            parts: [{ type: "text", text: "hi" }],
            outcome: "completed",
            error: null,
          },
          3000,
        ),
      ]) {
        doc = turn.apply(doc, e);
      }

      expect(hasRunTokenKey(doc)).toBe(false);
      expect(JSON.stringify(doc)).not.toContain(RUN_TOKEN);
    });
  });
});
