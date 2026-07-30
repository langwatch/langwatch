import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  applyLangyConversationSpineEvent,
  applyLangyConversationTurnEvent,
  initLangyConversationSpineState,
  initLangyConversationTurnState_,
  type LangyConversationSpineState,
  type LangyConversationTurnState,
} from "./folds";

const CONV = "conv-1";
const TURN = "turn-1";
const USER = "user-1";

interface SpineDelivery {
  readonly key: keyof typeof applyLangyConversationSpineEvent;
  readonly data: Record<string, unknown> & { occurredAt: number };
}

interface TurnDelivery {
  readonly key: keyof typeof applyLangyConversationTurnEvent;
  readonly data: Record<string, unknown> & { occurredAt: number };
}

function applySpine(
  state: LangyConversationSpineState,
  delivery: SpineDelivery,
): LangyConversationSpineState {
  return (
    applyLangyConversationSpineEvent[delivery.key] as (
      state: LangyConversationSpineState,
      data: SpineDelivery["data"],
    ) => LangyConversationSpineState
  )(state, delivery.data);
}

function applyTurn(
  state: LangyConversationTurnState,
  delivery: TurnDelivery,
): LangyConversationTurnState {
  return (
    applyLangyConversationTurnEvent[delivery.key] as (
      state: LangyConversationTurnState,
      data: TurnDelivery["data"],
    ) => LangyConversationTurnState
  )(state, delivery.data);
}

const spineEvents: SpineDelivery[] = [
  {
    key: "conversationStarted",
    data: {
      conversationId: CONV,
      userId: USER,
      title: null,
      runToken: "tok",
      occurredAt: 1_001,
    },
  },
  {
    key: "messageRecorded",
    data: {
      conversationId: CONV,
      userId: USER,
      messageId: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
      title: "hello",
      occurredAt: 1_002,
    },
  },
  {
    key: "agentTurnAccepted",
    data: { conversationId: CONV, turnId: TURN, occurredAt: 1_003 },
  },
  {
    key: "toolCallSucceeded",
    data: {
      conversationId: CONV,
      turnId: TURN,
      toolCallId: "call-1",
      toolName: "bash",
      durationMs: 12,
      occurredAt: 1_004,
    },
  },
];

const turnEvents: TurnDelivery[] = [
  {
    key: "agentTurnAccepted",
    data: {
      conversationId: CONV,
      turnId: TURN,
      questionParts: [],
      occurredAt: 1_003,
    },
  },
  {
    key: "toolCallInitiated",
    data: {
      conversationId: CONV,
      turnId: TURN,
      toolCallId: "call-1",
      toolName: "bash",
      command: "ls",
      occurredAt: 1_004,
    },
  },
  {
    key: "toolCallSucceeded",
    data: {
      conversationId: CONV,
      turnId: TURN,
      toolCallId: "call-1",
      toolName: "bash",
      command: "ls",
      durationMs: 12,
      occurredAt: 1_005,
    },
  },
  {
    key: "planUpdated",
    data: {
      conversationId: CONV,
      turnId: TURN,
      items: [{ content: "read the file", status: "completed" }],
      occurredAt: 1_006,
    },
  },
];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const [first, ...rest] = items;
  return permutations(rest).flatMap((order) =>
    order
      .map((_unused, index) => [
        ...order.slice(0, index),
        first as T,
        ...order.slice(index),
      ])
      .concat([[...order, first as T]]),
  );
}

function fieldsThatDiffer(states: readonly object[]): string[] {
  const records = states.map((state) =>
    Object.fromEntries(Object.entries(state)),
  );
  const [reference, ...rest] = records;
  if (!reference) return [];
  return Object.keys(reference)
    .filter((field) =>
      rest.some(
        (record) =>
          JSON.stringify(record[field]) !== JSON.stringify(reference[field]),
      ),
    )
    .sort();
}

/**
 * The spine fold is `packages/langy`'s `foldLangyConversationState`, shared with
 * the browser and not this pipeline's to change. Two of its fields are not
 * order- or delivery-invariant, and both tests below name exactly which — so a
 * fix in that package turns them red rather than passing unnoticed, and a NEW
 * divergence is caught by the same assertion.
 */
describe("the conversation spine fold", () => {
  it("is not yet a function of the set of its events", () => {
    const report = checkOrderInvariance({
      init: initLangyConversationSpineState,
      apply: applySpine,
      events: spineEvents,
    });

    expect(report.invariant).toBe(false);
    expect(report.counterexample).toBeDefined();
  });

  it("diverges on Status alone when a batch is reordered", () => {
    const states = permutations(spineEvents).map((order) =>
      order.reduce(applySpine, initLangyConversationSpineState()),
    );

    expect(fieldsThatDiffer(states)).toEqual(["Status"]);
  });

  it("diverges on MessageCount alone when a delivery is retried", () => {
    const once = spineEvents.reduce(applySpine, initLangyConversationSpineState());
    const retried = spineEvents
      .concat(spineEvents)
      .reduce(applySpine, initLangyConversationSpineState());

    expect(fieldsThatDiffer([once, retried])).toEqual(["MessageCount"]);
  });
});

describe("the turn fold", () => {
  it("reaches the same state whatever order the batch arrives in", () => {
    const report = checkOrderInvariance({
      init: initLangyConversationTurnState_,
      apply: applyTurn,
      events: turnEvents,
    });

    expect(report.counterexample).toBeUndefined();
    expect(report.invariant).toBe(true);
  });
});
