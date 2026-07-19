import { describe, expect, it, vi } from "vitest";

import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { createStubLangyEffectPorts } from "~/server/app-layer/langy/process-manager";
import { LANGY_CONVERSATION_PROCESS_NAME } from "~/server/app-layer/langy/process-manager";
import {
  agentRespondedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
} from "../../../../app-layer/langy/process-manager/__tests__/helpers/langyEventFixtures";
import {
  createLangyConversationProcessingPipeline,
  type LangyConversationProcessingPipelineDeps,
} from "../pipeline";
import type { LangyAnalyticsEventProjectionRecord } from "../projections/langyAnalyticsEvent.mapProjection";
import {
  LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES,
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
} from "../schemas/constants";
import type { LangyConversationProcessingEvent } from "../schemas/events";

/**
 * Proves the FINAL Langy pipeline shape from the public static definition
 * (ADR-046): the operational read models are two `withProjection` state folds
 * (conversation + turn) plus a Postgres message map; analytics is a SEPARATE
 * pure map; live subscribers are independent; and no Langy operational
 * projection carries a reactor/outbox contract.
 */

/** Append-only store — deliberately no load/read/get, matching the map contract. */
function appendStore<T>(
  append: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
): AppendStore<T> {
  return { append: append as unknown as AppendStore<T>["append"] };
}

function stateStore<T>(): StateProjectionStore<T> {
  return {
    load: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(undefined),
  };
}

// `langyConversationProcess` is deliberately absent: the process is declared
// on the pipeline now, so ProcessRuntime generates its `pm:langyConversation`
// subscriber. These are the hand-written live consumers only.
const SUBSCRIBER_NAMES = [
  "agentTurnLiveness",
  "langyConversationUpdateBroadcast",
] as const;

function buildPipeline(
  overrides: Partial<LangyConversationProcessingPipelineDeps> = {},
) {
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
    pipeline: createLangyConversationProcessingPipeline(deps),
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
] as const;

describe("langy-conversation-processing pipeline shape", () => {
  describe("given the pipeline built from its public static definition", () => {
    describe("when inspecting the operational read models", () => {
      it("registers conversation and turn as withProjection state projections, not folds", () => {
        const { pipeline } = buildPipeline();

        expect([...(pipeline.stateProjections?.keys() ?? [])].sort()).toEqual([
          "langyConversationState",
          "langyConversationTurn",
        ]);
        // withProjection state projections never land in the legacy fold registry.
        expect(pipeline.foldProjections.size).toBe(0);
      });

      it("registers messages as a Postgres operational map alongside a separate analytics map", () => {
        const { pipeline } = buildPipeline();

        expect([...pipeline.mapProjections.keys()].sort()).toEqual([
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

        const pm = pipeline.processManagers.get(
          LANGY_CONVERSATION_PROCESS_NAME,
        );
        expect(pm).toBeDefined();
        expect(pm!.config.eventTypes.length).toBeGreaterThan(0);
        // The content boundary is what keeps message parts and tokens out of
        // process state and outbox rows.
        expect(pm!.config.toPayload).toBeDefined();
        expect(Object.keys(pm!.config.intents).sort()).toEqual([
          "langy.conversation.generate_title",
          "langy.conversation.worker_dispatch",
        ]);
      });
    });

    describe("when inspecting reactor and outbox attachments", () => {
      it("attaches no reactor or outbox to any Langy operational projection", () => {
        const { pipeline } = buildPipeline();

        expect(pipeline.foldReactors.size).toBe(0);
        expect(pipeline.mapReactors.size).toBe(0);
      });
    });

    describe("when inspecting live event subscribers", () => {
      it("keeps subscribers independent of projections and reactors", () => {
        const { pipeline, subscribers } = buildPipeline();

        expect([...pipeline.eventSubscribers.keys()].sort()).toEqual(
          [...SUBSCRIBER_NAMES].sort(),
        );
        for (const subscriber of subscribers) {
          expect(pipeline.eventSubscribers.get(subscriber.name)).toBe(
            subscriber,
          );
        }
        // An independent subscriber is not smuggled in as a reactor.
        expect(pipeline.foldReactors.size).toBe(0);
        expect(pipeline.mapReactors.size).toBe(0);
      });

      it("builds without any subscribers wired", () => {
        const { pipeline } = buildPipeline({ subscribers: [] });

        expect(pipeline.eventSubscribers.size).toBe(0);
      });
    });

    describe("when inspecting the command write surface", () => {
      it("registers every expected command exactly once", () => {
        const { pipeline } = buildPipeline();

        const names = pipeline.commands.map((c) => c.name).sort();
        expect(names).toEqual([...EXPECTED_COMMANDS].sort());
        // One handler per durable command in the vocabulary.
        expect(pipeline.commands).toHaveLength(
          LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES.length,
        );
      });
    });
  });

  describe("given the analytics map projection from the static definition", () => {
    function analyticsDefinition() {
      const { pipeline, analyticsAppend } = buildPipeline();
      const definition = pipeline.mapProjections.get(
        "langyAnalyticsEvent",
      )?.definition;
      if (!definition) throw new Error("langyAnalyticsEvent not registered");
      return { definition, analyticsAppend };
    }

    describe("when comparing consumed event types to the durable vocabulary", () => {
      it("consumes every Langy durable event type", () => {
        const { definition } = analyticsDefinition();

        expect([...definition.eventTypes].sort()).toEqual(
          [...LANGY_CONVERSATION_PROCESSING_EVENT_TYPES].sort(),
        );
      });
    });

    describe("when a queued event is mapped into the store", () => {
      it("appends the event-derived record without any load/read method on the store", async () => {
        const { definition, analyticsAppend } = analyticsDefinition();
        const event = agentRespondedEvent({
          id: "evt_agent_responded",
          occurredAt: 1_752_600_500_000,
          turnId: "turn_1",
        });
        const context: ProjectionStoreContext = {
          aggregateId: CONVERSATION_ID,
          tenantId: PROJECT_ID as unknown as ProjectionStoreContext["tenantId"],
        };

        // The framework's per-event step: pure map -> append. No prior read.
        const record = definition.map(event as LangyConversationProcessingEvent);
        expect(record).not.toBeNull();
        await definition.store.append(record!, context);

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
        expect(typeof definition.store.append).toBe("function");
        expect(definition.store).not.toHaveProperty("load");
        expect(definition.store).not.toHaveProperty("read");
        expect(definition.store).not.toHaveProperty("get");
      });
    });
  });
});
