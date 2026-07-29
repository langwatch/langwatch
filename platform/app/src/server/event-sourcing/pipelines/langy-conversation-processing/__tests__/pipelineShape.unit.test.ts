import {
  LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES,
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
} from "@langwatch/langy";
import { describe, expect, it, vi } from "vitest";
import { NullLangyTurnAdmissionRepository } from "~/server/app-layer/langy/repositories/langy-turn-admission.repository";
import { LANGY_CONVERSATION_PROCESS_NAME } from "~/server/event-sourcing/pipelines/langy-conversation-processing/process-manager";
import {
  agentRespondedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
} from "../../../../event-sourcing/pipelines/langy-conversation-processing/process-manager/__tests__/helpers/langyEventFixtures";
import type { CommandBus } from "../../../commands/commandBus";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  createLangyConversationProcessingPipeline,
  type LangyConversationProcessingPipelineDeps,
} from "../pipeline";
import type { LangyAnalyticsEventProjectionRecord } from "../projections/langyAnalyticsEvent.mapProjection";
import type { LangyConversationProcessingEvent } from "../schemas/events";

/**
 * Proves the FINAL Langy pipeline shape from the public static definition
 * (ADR-046): the operational read models are two `withProjection` state folds
 * (conversation + turn) plus a Postgres message map; analytics is a SEPARATE
 * pure map; live subscribers are independent; and deferred work belongs to the
 * declared process manager, not to any operational projection.
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
// subscriber. These are the hand-written live consumers only — and since
// ADR-082 the pipeline constructs them itself, so this list is the production
// set rather than whatever a caller chose to inject.
const SUBSCRIBER_NAMES = [
  "agentTurnLiveness",
  "langyConversationUpdateBroadcast",
  "langyTurnAdmissionLifecycle",
] as const;

/**
 * A bus whose ports never dispatch. The pipeline binds three of its own
 * commands through it at build time; nothing in a shape test sends one.
 */
function stubCommandBus(): CommandBus {
  const noop = async (): Promise<void> => {};
  return {
    send: noop,
    sendBatch: noop,
    port: () => noop,
  };
}

function buildPipeline(
  overrides: Partial<LangyConversationProcessingPipelineDeps> = {},
) {
  const analyticsAppend = vi.fn().mockResolvedValue(undefined);
  const deps: LangyConversationProcessingPipelineDeps = {
    langyConversationProjectionStore: stateStore(),
    langyConversationTurnProjectionStore: stateStore(),
    langyMessageProjectionStore: appendStore(),
    langyAnalyticsEventProjectionStore:
      appendStore<LangyAnalyticsEventProjectionRecord>(analyticsAppend),
    langyTurnAdmissionRepository: new NullLangyTurnAdmissionRepository(),
    tokenBuffer: {
      liveness: async () => ({ present: false, stale: true, lastBeatAt: null }),
      appendStatus: async () => undefined,
      markError: async () => undefined,
    },
    handoffStore: {
      read: async () => null,
      stash: async () => undefined,
    },
    worker: { dispatch: async () => "accepted" },
    titleGenerator: async () => null,
    broadcast: { broadcastToTenant: async () => undefined },
    mintSessionKey: async () => ({ token: "t", apiKeyId: "k" }),
    revokeSessionKey: async () => undefined,
    commands: stubCommandBus(),
    ...overrides,
  };
  return {
    pipeline: createLangyConversationProcessingPipeline(deps),
    analyticsAppend,
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
        expect(
          pipeline.mapProjections.get("langyAnalyticsEvent")?.definition,
        ).not.toBe(
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

    describe("when inspecting live event subscribers", () => {
      it("keeps subscribers independent of the projections", () => {
        const { pipeline } = buildPipeline();

        expect([...pipeline.eventSubscribers.keys()].sort()).toEqual(
          [...SUBSCRIBER_NAMES].sort(),
        );
      });

      it("mounts the real handlers, not a caller-supplied set", () => {
        // ADR-082 Rule 1: the pipeline constructs its own live consumers, so
        // there is no injection seam a composition root could leave empty.
        // Each one declares the events it reacts to; a stub with the right
        // name would not.
        const { pipeline } = buildPipeline();

        for (const name of SUBSCRIBER_NAMES) {
          const subscriber = pipeline.eventSubscribers.get(name);
          expect(subscriber).toBeDefined();
          expect(subscriber!.eventTypes.length).toBeGreaterThan(0);
        }
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
        const record = definition.map(
          event as LangyConversationProcessingEvent,
        );
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
