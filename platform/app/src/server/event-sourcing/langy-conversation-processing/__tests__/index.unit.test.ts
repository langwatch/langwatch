import type { ClickHouseClient } from "@langwatch/clickhouse";
import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { describe, expect, it, vi } from "vitest";
import {
  checkLangyConversationProcessingRatchet,
  createLangyConversationProcessingPipeline,
  type LangyConversationEffects,
  langyAnalyticsEventGroupKey,
  langyConversationCommandGroupKey,
  langyConversationProcessGroupKey,
  langyConversationStateGroupKey,
  langyConversationTurnGroupKey,
  langyMessageOperationalGroupKey,
} from "../index";
import type { LangyProjectionPrisma } from "../postgres";
import {
  currentLangyConversationProcessingTypeStrings,
  LANGY_CONVERSATION_PROCESSING_TYPE_STRING_SNAPSHOT,
} from "../ratchet";

const client = {} as ClickHouseClient;

const prisma = {
  langyConversationProjection: { findUnique: vi.fn(), upsert: vi.fn() },
  langyConversationTurnProjection: { findUnique: vi.fn(), upsert: vi.fn() },
  langyMessageProjection: { upsert: vi.fn() },
} as unknown as LangyProjectionPrisma;

const effects: LangyConversationEffects = {
  workerDispatch: { dispatchTurn: vi.fn() },
  titleGeneration: { generateTitle: vi.fn() },
};

function build() {
  return createLangyConversationProcessingPipeline({ client, prisma, effects });
}

describe("langy-conversation-processing composition", () => {
  it("mounts two folds, two maps, one process manager and every command", () => {
    const pipeline = build();

    expect(pipeline.name).toBe("langy_conversation");
    expect(Object.keys(pipeline.folds).sort()).toEqual([
      "langyConversationState",
      "langyConversationTurn",
    ]);
    expect(Object.keys(pipeline.maps).sort()).toEqual([
      "langyAnalyticsEvent",
      "langyMessageOperational",
    ]);
    expect(Object.keys(pipeline.processManagers)).toEqual([
      "langyConversation",
    ]);
    expect(Object.keys(pipeline.commands).sort()).toEqual(
      [
        "acceptAgentTurn",
        "archiveConversation",
        "consumeTurnHandoff",
        "createConversation",
        "failAgentResponse",
        "failToolCall",
        "forkConversation",
        "generateConversationTitle",
        "importMessage",
        "initiateToolCall",
        "recordAgentResponse",
        "recordMessage",
        "recordTurnHandoff",
        "succeedToolCall",
        "updateConversationMetadata",
        "updatePlan",
      ].sort(),
    );
  });

  it("pins both folds to their deployed version, not a derived hash", () => {
    const pipeline = build();

    expect(pipeline.folds.langyConversationState!.stateVersion).toBe(
      "2026-07-10",
    );
    expect(pipeline.folds.langyConversationTurn!.stateVersion).toBe(
      "2026-07-15",
    );
  });

  it("subscribes every map only to events the pipeline declares", () => {
    const pipeline = build();
    const declared = new Set<string>(pipeline.eventTypes);

    for (const map of Object.values(pipeline.maps)) {
      for (const eventType of map.eventTypes) {
        expect(declared.has(eventType)).toBe(true);
      }
    }
  });

  it("gives the process manager the eight events event-sourcing.old wires it to", () => {
    const pipeline = build();

    expect(
      [...pipeline.processManagers.langyConversation!.eventTypes].sort(),
    ).toEqual(
      [
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
        LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
        LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
        LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
        LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
        LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
      ].sort(),
    );
    expect(
      pipeline.processManagers.langyConversation!.intentTypes.sort(),
    ).toEqual(
      [
        "langyConversation/generateTitle",
        "langyConversation/workerDispatch",
      ].sort(),
    );
  });
});

describe("the dispatch lanes", () => {
  const tenantId = "project-1";
  const conversationScope = {
    kind: "aggregate",
    aggregateType: "langy_conversation",
    aggregateId: "conv-1",
  };

  it("puts the command, the spine fold, the process and the analytics map on the conversation", () => {
    expect(
      langyConversationCommandGroupKey({
        tenantId,
        command: "recordMessage",
        conversationId: "conv-1",
      }),
    ).toEqual({
      tenantId,
      lane: { kind: "command", name: "recordMessage" },
      scope: conversationScope,
    });
    expect(
      langyConversationStateGroupKey({ tenantId, conversationId: "conv-1" }),
    ).toEqual({
      tenantId,
      lane: { kind: "fold", name: "langyConversationState" },
      scope: conversationScope,
    });
    expect(
      langyConversationProcessGroupKey({ tenantId, conversationId: "conv-1" }),
    ).toEqual({
      tenantId,
      lane: { kind: "processManager", name: "langyConversation" },
      scope: conversationScope,
    });
    expect(
      langyAnalyticsEventGroupKey({ tenantId, conversationId: "conv-1" }),
    ).toEqual({
      tenantId,
      lane: { kind: "map", name: "langyAnalyticsEvent" },
      scope: conversationScope,
    });
  });

  it("narrows the turn fold's lane to one turn, matching its own fold key", () => {
    expect(
      langyConversationTurnGroupKey({
        tenantId,
        conversationId: "conv-1",
        turnId: "turn-1",
      }),
    ).toEqual({
      tenantId,
      lane: { kind: "fold", name: "langyConversationTurn" },
      scope: {
        kind: "aggregate",
        aggregateType: "langy_conversation_turn",
        aggregateId: "conv-1:turn-1",
      },
    });
  });

  it("gives every message-bearing event its own lane", () => {
    expect(
      langyMessageOperationalGroupKey({ tenantId, eventId: "event-1" }),
    ).toEqual({
      tenantId,
      lane: { kind: "map", name: "langyMessageOperational" },
      scope: { kind: "event", eventId: "event-1" },
    });
  });
});

describe("the type-string ratchet", () => {
  it("reports no violation against the committed snapshot", () => {
    expect(checkLangyConversationProcessingRatchet()).toEqual([]);
  });

  it("holds the strings the pipeline declares right now", () => {
    expect(currentLangyConversationProcessingTypeStrings()).toEqual({
      langy_conversation:
        LANGY_CONVERSATION_PROCESSING_TYPE_STRING_SNAPSHOT.langy_conversation,
    });
  });

  it("reports a string the snapshot remembers but the pipeline dropped", () => {
    const dropped = "lw.langy_conversation.conversation_started";
    const current = currentLangyConversationProcessingTypeStrings();
    const violations = checkTypeStringRatchet({
      snapshot: LANGY_CONVERSATION_PROCESSING_TYPE_STRING_SNAPSHOT,
      current: {
        langy_conversation: current.langy_conversation!.filter(
          (type) => type !== dropped,
        ),
      },
    });

    expect(violations).toEqual([
      { declaration: "langy_conversation", missing: [dropped] },
    ]);
  });
});
