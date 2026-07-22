/**
 * ADR-059's central claim, asserted rather than asserted-about: the browser and
 * the backend fold the SAME recorded steps into the SAME turn state, because it
 * is literally the same reducer.
 *
 * The two sides differ only in their RIG. The server routes each event to a
 * handler derived from its `type` and stamps bookkeeping timestamps
 * (`AbstractFoldProjection`); the browser walks a fetched tail behind a cursor
 * guard (`applyLangyTurnEvents`). This test drives one identical recorded
 * sequence through both rigs and compares the fold-owned fields — so a rig that
 * drops an event type, mis-routes one, or filters the tail differently breaks
 * here, at the seam, instead of as a rendering difference nobody can reproduce.
 *
 * Spec: specs/langy/langy-event-sourced-frontend.feature
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TURN_TOOL_CALL_STATUS,
  applyLangyTurnEvents,
  initialLangyTurnProjection,
  langyConversationTurnEventSchema,
  type LangyConversationTurnData,
  type LangyConversationTurnFoldState,
} from "@langwatch/langy";
import { describe, expect, it } from "vitest";

import { createTenantId } from "../../../../domain/tenantId";
import type { StateProjectionStore } from "../../../../projections/stateProjection.types";
import type { LangyConversationProcessingEvent } from "../../schemas/events";
import { LangyConversationTurnFoldProjection } from "../langyConversationTurn.foldProjection";

const TENANT = createTenantId("project-1");
const CONVERSATION = "conv-1";
const TURN = "turn-1";
const IDS = { conversationId: CONVERSATION, turnId: TURN };

/**
 * One recorded step, in the only form both sides agree on: identity, the two
 * clocks, the type and the payload. Everything else on either side is rig.
 */
interface RecordedStep {
  id: string;
  createdAt: number;
  occurredAt: number;
  type: string;
  version: string;
  data: Record<string, unknown>;
}

/** A whole turn: accepted → tool call → plan → answer. */
const RECORDED_STEPS: RecordedStep[] = [
  {
    id: "2Aevt00001",
    createdAt: 1_000,
    occurredAt: 990,
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
    data: { ...IDS, questionParts: [{ type: "text", text: "why failing?" }] },
  },
  {
    id: "2Aevt00002",
    createdAt: 2_000,
    occurredAt: 1_990,
    type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED,
    data: {
      ...IDS,
      toolCallId: "tc-1",
      toolName: "bash",
      command: "grep traces",
      input: { q: "traces" },
    },
  },
  {
    id: "2Aevt00003",
    createdAt: 3_000,
    occurredAt: 2_990,
    type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
    data: { ...IDS, toolCallId: "tc-1", toolName: "bash", durationMs: 420 },
  },
  {
    id: "2Aevt00004",
    createdAt: 4_000,
    occurredAt: 3_990,
    type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED,
    data: {
      ...IDS,
      items: [
        { content: "read the trace", status: "completed" },
        { content: "explain it", status: "in_progress" },
      ],
    },
  },
  {
    id: "2Aevt00005",
    createdAt: 5_000,
    occurredAt: 4_990,
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
    data: {
      ...IDS,
      messageId: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "the retry budget ran out." }],
      outcome: "completed",
    },
  },
];

const noopStore: StateProjectionStore<LangyConversationTurnData> = {
  store: async () => {},
  load: async () => null,
};

/** How the backend sees a recorded step: the full branded event envelope. */
function asServerEvent(step: RecordedStep): LangyConversationProcessingEvent {
  return {
    ...step,
    aggregateId: CONVERSATION,
    aggregateType: "langy_conversation",
    tenantId: TENANT,
  } as unknown as LangyConversationProcessingEvent;
}

/**
 * How the browser sees the same step: parsed through the wire schema the
 * authorized tail read serves — so the two sides are compared over the payload
 * the client can ACTUALLY obtain, not a hand-built optimistic copy of it.
 */
function asWireEvent(step: RecordedStep) {
  return langyConversationTurnEventSchema.parse({
    id: step.id,
    createdAt: step.createdAt,
    occurredAt: step.occurredAt,
    type: step.type,
    data: step.data,
  });
}

/**
 * The fold-owned fields, with the rig's bookkeeping stamps removed. The server
 * projection stamps `CreatedAt`/`UpdatedAt` from the wall clock and tracks
 * `LastEventOccurredAt`; none of them is a fold decision, and the shared
 * `LangyConversationTurnFoldState` type omits all three by construction.
 */
function foldOwnedFields(
  state: LangyConversationTurnData,
): LangyConversationTurnFoldState {
  const { CreatedAt, UpdatedAt, LastEventOccurredAt, ...folded } = state;
  return folded;
}

describe("given the recorded steps of a completed turn", () => {
  const serverProjection = new LangyConversationTurnFoldProjection({
    store: noopStore,
  });

  const backendState = RECORDED_STEPS.reduce(
    (state, step) => serverProjection.apply(state, asServerEvent(step)),
    serverProjection.init(),
  );
  const browserState = applyLangyTurnEvents(
    initialLangyTurnProjection,
    RECORDED_STEPS.map(asWireEvent),
  );

  describe("when the browser folds them locally and the backend folds them durably", () => {
    /** @scenario The same recorded steps produce the same turn state on both sides */
    it("arrives at the identical turn state on both sides", () => {
      expect(browserState.turn).toEqual(foldOwnedFields(backendState));
    });

    it("folds a whole turn on both sides — the comparison is not of two empties", () => {
      // Guards the assertion above: two blank documents would also be equal.
      expect(backendState.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.COMPLETED);
      expect(backendState.ToolCalls).toHaveLength(1);
      expect(backendState.ToolCalls[0]?.status).toBe(
        LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
      );
      expect(backendState.Plan).toHaveLength(2);
      expect(backendState.AnswerParts).toHaveLength(1);
      expect(backendState.QuestionParts).toHaveLength(1);
    });

    it("leaves the browser positioned at the last recorded step it folded", () => {
      const last = RECORDED_STEPS.at(-1)!;
      expect(browserState.cursor).toEqual({
        acceptedAt: last.createdAt,
        eventId: last.id,
      });
      expect(browserState.turnId).toBe(TURN);
    });
  });
});
