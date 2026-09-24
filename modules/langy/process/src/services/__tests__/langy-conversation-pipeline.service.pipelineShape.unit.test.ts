import {
  type AppendStore,
  createTenantId,
  type EventSubscriberDefinition,
  type ProjectionStoreContext,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES,
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";

import { createStubLangyEffectPorts } from "../../app/__tests__/langy.fixture.ts";
import {
  agentRespondedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
} from "../../eventing/__tests__/langyEventFixtures.ts";
import type { LangyAnalyticsEventProjectionRecord } from "../../eventing/langy-analytics-event.projection.ts";
import { LANGY_CONVERSATION_PROCESS_NAME } from "../../eventing/langy-conversation-process.schemas.ts";
import type { LangyConversationProcessingEvent } from "../../eventing/langy-conversation-state.projection.ts";
import {
  LangyConversationPipelineAdapter,
  type LangyConversationProcessingPipelineDeps,
} from "../langy-conversation-pipeline.service.ts";

/**
 * Proves the FINAL Langy pipeline shape from the public static definition (conversation + turn)
 * plus a Postgres message map; analytics is a SEPARATE pure map; live subscribers are independent;
 * (ADR-046): the operational read models are two `withProjection` state folds
 */

/** Append-only store — deliberately no load/read/get, matching the map contract. */
function appendStore<T>(
  append: AppendStore<T>["append"] = vi.fn().mockResolvedValue(undefined),
): AppendStore<T> {
  return { append };
}

function stateStore<T>(): StateProjectionStore<T> {
  return {
    get: vi.fn().mockResolvedValue({ kind: "empty" }),
    store: vi.fn().mockResolvedValue(undefined),
  };
}

// `langyConversationProcess` is deliberately absent: the process is declared
// on the pipeline now, so ProcessRuntime generates its `pm:langyConversation`
// subscriber. These are the hand-written live consumers only.
const SUBSCRIBER_NAMES = ["agentTurnLiveness", "langyConversationUpdateBroadcast"] as const;

function buildPipeline(overrides: Partial<LangyConversationProcessingPipelineDeps> = {}) {
  const analyticsAppend = vi.fn().mockResolvedValue(undefined);
  const subscribers: EventSubscriberDefinition<LangyConversationProcessingEvent>[] =
    SUBSCRIBER_NAMES.map((name) => ({
      name,
      eventTypes: [],
      handle: vi.fn(),
    }));
  const deps: LangyConversationProcessingPipelineDeps = {
    langyConversationProjectionStore: stateStore(),
    langyConversationTurnProjectionStore: stateStore(),
    langyMessageProjectionStore: appendStore(),
    langyAnalyticsEventProjectionStore:
      appendStore<LangyAnalyticsEventProjectionRecord>(analyticsAppend),
    subscribers,
    langyProcessPorts: createStubLangyEffectPorts().ports,
    ...overrides,
  };
  return {
    pipeline: LangyConversationPipelineAdapter.create(deps).build(),
    analyticsAppend,
    subscribers,
  };
}

const EXPECTED_COMMANDS = [
  "createConversation",
  "forkConversation",
  "recordMessage",
  "importMessage",
  "acceptAgentTurn",
  "initiateToolCall",
  "succeedToolCall",
  "failToolCall",
  "updatePlan",
  "failAgentResponse",
  "recordAgentResponse",
  "archiveConversation",
  "updateConversationMetadata",
  "recordTurnHandoff",
  "consumeTurnHandoff",
  "generateConversationTitle",
  "requestLocalControl",
  "connectLocalWorkspace",
  "disconnectLocalWorkspace",
  "changeLocalPolicy",
  "startUserWait",
  "endUserWait",
] as const;

describe("langy-conversation-processing pipeline shape", () => {
  describe("given the pipeline built from its public static definition", () => {
    describe("when inspecting the operational read models", () => {
      it("registers conversation and turn as withProjection state projections, not folds", () => {
        const { pipeline } = buildPipeline();

        expect([...(pipeline.stateProjections?.keys() ?? [])].toSorted()).toEqual([
          "langyConversationState",
          "langyConversationTurn",
        ]);
        // withProjection state projections never land in the legacy fold registry.
        expect(pipeline.foldProjections.size).toBe(0);
      });

      it("registers messages as a Postgres operational map alongside a separate analytics map", () => {
        const { pipeline } = buildPipeline();

        expect([...pipeline.mapProjections.keys()].toSorted()).toEqual([
          "langyAnalyticsEvent",
          "langyMessageOperational",
        ]);
        // The analytics map is a distinct registration from the message map.
        expect(pipeline.mapProjections.get("langyAnalyticsEvent")?.definition).not.toBe(
          pipeline.mapProjections.get("langyMessageOperational")?.definition,
        );
      });
    });

    describe("when inspecting the declared process manager", () => {
      it("declares the conversation process on the pipeline", () => {
        // ADR-052: the topology lives here, not in the registry. If this
        // regresses to zero the process silently stops being mounted.
        const { pipeline } = buildPipeline();

        const pm = pipeline.processManagers.get(LANGY_CONVERSATION_PROCESS_NAME);
        expect(pm).toBeDefined();
        expect(pm!.config.eventTypes.length).toBeGreaterThan(0);
        // The content boundary is what keeps message parts and tokens out of
        // process state and outbox rows.
        expect(pm!.config.toPayload).toBeDefined();
        expect(Object.keys(pm!.config.intents).toSorted()).toEqual([
          "langy.conversation.generate_title",
          "langy.conversation.worker_dispatch",
        ]);
      });
    });

    describe("when inspecting subscriber and outbox attachments", () => {
      it("attaches no subscriber or outbox to any Langy operational projection", () => {
        const { pipeline } = buildPipeline();

        expect(pipeline.foldSubscribers.size).toBe(0);
        expect(pipeline.mapSubscribers.size).toBe(0);
      });
    });

    describe("when inspecting live event subscribers", () => {
      it("keeps subscribers independent of projections and subscribers", () => {
        const { pipeline, subscribers } = buildPipeline();

        expect([...pipeline.eventSubscribers.keys()].toSorted()).toEqual(
          [...SUBSCRIBER_NAMES].toSorted(),
        );
        for (const subscriber of subscribers) {
          expect(pipeline.eventSubscribers.get(subscriber.name)).toBe(subscriber);
        }
        // A live event subscriber is not smuggled into either projection
        // subscriber registry.
        expect(pipeline.foldSubscribers.size).toBe(0);
        expect(pipeline.mapSubscribers.size).toBe(0);
      });

      it("builds without any subscribers wired", () => {
        const { pipeline } = buildPipeline({ subscribers: [] });

        expect(pipeline.eventSubscribers.size).toBe(0);
      });
    });

    describe("when inspecting the command write surface", () => {
      it("registers every expected command exactly once", () => {
        const { pipeline } = buildPipeline();

        const names = pipeline.commands.map((c) => c.name).toSorted();
        expect(names).toEqual([...EXPECTED_COMMANDS].toSorted());
        // One handler per durable command in the vocabulary.
        expect(pipeline.commands).toHaveLength(LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES.length);
      });
    });
  });

  describe("given the analytics map projection from the static definition", () => {
    function analyticsDefinition() {
      const { pipeline, analyticsAppend } = buildPipeline();
      const projection = pipeline.mapProjections.get("langyAnalyticsEvent");
      if (!projection) throw new Error("langyAnalyticsEvent not registered");
      return { definition: projection.definition, projection, analyticsAppend };
    }

    describe("when comparing consumed event types to the durable vocabulary", () => {
      it("consumes every Langy durable event type", () => {
        const { definition } = analyticsDefinition();

        expect([...definition.eventTypes].toSorted()).toEqual(
          [...LANGY_CONVERSATION_PROCESSING_EVENT_TYPES].toSorted(),
        );
      });
    });

    describe("when a queued event is mapped into the store", () => {
      it("appends the event-derived record without any load/read method on the store", async () => {
        const { projection, analyticsAppend } = analyticsDefinition();
        const event = agentRespondedEvent({
          id: "evt_agent_responded",
          occurredAt: 1_752_600_500_000,
          turnId: "turn_1",
        });
        const context: ProjectionStoreContext = {
          aggregateId: CONVERSATION_ID,
          tenantId: createTenantId(PROJECT_ID),
        };

        // The framework's per-event step: pure map -> append. No prior read.
        const record = await projection.open(async (definition) => {
          const mapped = definition.map(event as LangyConversationProcessingEvent);
          expect(mapped).not.toBeNull();
          await definition.store.append(mapped!, context);
          return mapped;
        });

        expect(analyticsAppend).toHaveBeenCalledTimes(1);
        expect(analyticsAppend).toHaveBeenCalledWith(record, context);
        expect(record).toMatchObject({
          eventId: event.id,
          eventType: event.type,
          aggregateId: event.aggregateId,
          turnId: "turn_1",
          role: "assistant",
          outcome: "completed",
          occurredAtMs: event.occurredAt,
          acceptedAtMs: event.createdAt,
        });

        // The store is append-only: it exposes no operational read path.
        const store = projection.open((definition): object => definition.store);
        expect(store).toHaveProperty("append", expect.any(Function));
        expect(store).not.toHaveProperty("load");
        expect(store).not.toHaveProperty("read");
        expect(store).not.toHaveProperty("get");
      });
    });
  });
});
