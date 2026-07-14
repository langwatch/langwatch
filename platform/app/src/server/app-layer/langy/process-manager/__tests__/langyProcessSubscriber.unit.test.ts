import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  InMemoryProcessStore,
  ProcessManagerService,
  type HandleResult,
  type ProcessEventEnvelope,
  type ProcessRef,
} from "~/server/event-sourcing/process-manager";
import { OutboxDispatcherService } from "~/server/event-sourcing/process-manager";
import { LANGY_CONVERSATION_PROCESSING_EVENT_TYPES } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

import {
  langyConversationProcessDefinition,
  toLangyProcessEnvelope,
} from "../langyConversationProcess.definition";
import {
  LANGY_CONVERSATION_PROCESS_NAME,
  type LangyConversationProcessState,
} from "../langyConversationProcess.types";
import {
  createLangyIntentHandlers,
  createStubLangyEffectPorts,
} from "../langyEffectPorts";
import { createLangyProcessSubscriber } from "../langyProcessSubscriber";
import {
  agentRespondedEvent,
  agentTurnAcceptedEvent,
  conversationStartedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  SENTINELS,
  T0,
  toolCallInitiatedEvent,
} from "./helpers/langyEventFixtures";

const ref: ProcessRef = {
  processName: LANGY_CONVERSATION_PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: CONVERSATION_ID,
};

const subscriberContext: EventSubscriberContext = {
  tenantId: PROJECT_ID,
  aggregateId: CONVERSATION_ID,
};

const FIXED_NOW = T0 + 500;

function lifecycleHistory(): LangyConversationProcessingEvent[] {
  return [
    conversationStartedEvent({ id: "evt_conv", occurredAt: T0 }),
    agentTurnAcceptedEvent({
      id: "evt_started",
      occurredAt: T0 + 1_000,
      turnId: "turn_1",
    }),
    toolCallInitiatedEvent({
      id: "evt_tool",
      occurredAt: T0 + 2_000,
      turnId: "turn_1",
    }),
    agentRespondedEvent({
      id: "evt_done",
      occurredAt: T0 + 3_000,
      turnId: "turn_1",
    }),
  ];
}

describe("createLangyProcessSubscriber", () => {
  describe("given the framework subscriber seam", () => {
    it("declares the Langy pipeline's event types and receives no fold state", () => {
      const subscriber = createLangyProcessSubscriber({
        processManager: { handleEvent: vi.fn() },
      });

      expect(subscriber.name).toBe("langyConversationProcess");
      expect(subscriber.eventTypes).toEqual(
        LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
      );
      // handle takes only (event, context) — there is no foldState parameter
      // and the adapter has no store, ClickHouse, or projection dependency.
      expect(subscriber.handle.length).toBeLessThanOrEqual(2);
    });
  });

  describe("given an injected process-manager port", () => {
    it("hands the port a content-stripped envelope stamped with the injected clock", async () => {
      const handleEvent = vi
        .fn<
          (params: {
            envelope: ProcessEventEnvelope;
            now: number;
          }) => Promise<HandleResult>
        >()
        .mockResolvedValue({
          outcome: "committed",
          revision: 1,
          insertedMessageKeys: [],
          duplicateMessageKeys: [],
        });
      const notifyOutbox = vi.fn();
      const subscriber = createLangyProcessSubscriber({
        processManager: { handleEvent },
        notifyOutbox,
        clock: () => FIXED_NOW,
      });

      await subscriber.handle(
        agentTurnAcceptedEvent({
          id: "evt_started",
          occurredAt: T0 + 1_000,
          turnId: "turn_1",
        }),
        subscriberContext,
      );

      expect(handleEvent).toHaveBeenCalledTimes(1);
      const call = handleEvent.mock.calls[0]![0];
      expect(call.now).toBe(FIXED_NOW);
      expect(call.envelope).toMatchObject({
        eventId: "evt_started",
        eventType: "lw.langy_conversation.agent_turn_accepted",
        occurredAt: T0 + 1_000,
        tenantId: PROJECT_ID,
        projectId: PROJECT_ID,
        processKey: CONVERSATION_ID,
      });
      // The payload is the stripped view — identities and flags only.
      expect(call.envelope.payload).toEqual({
        turnId: "turn_1",
        outcome: null,
        titleTouched: false,
      });
      expect(JSON.stringify(call)).not.toContain(SENTINELS.questionText);
      expect(notifyOutbox).toHaveBeenCalledOnce();
    });

    it("swallows duplicate delivery as the no-op it is", async () => {
      const handleEvent = vi.fn().mockResolvedValue({
        outcome: "duplicateEvent",
      } satisfies HandleResult);
      const notifyOutbox = vi.fn();
      const subscriber = createLangyProcessSubscriber({
        processManager: { handleEvent },
        notifyOutbox,
      });

      await expect(
        subscriber.handle(
          conversationStartedEvent({ id: "evt_conv", occurredAt: T0 }),
          subscriberContext,
        ),
      ).resolves.toBeUndefined();
      expect(notifyOutbox).not.toHaveBeenCalled();
    });

    it("throws on a revision conflict so the queue redelivers", async () => {
      const handleEvent = vi.fn().mockResolvedValue({
        outcome: "revisionConflict",
        actualRevision: 4,
      } satisfies HandleResult);
      const subscriber = createLangyProcessSubscriber({
        processManager: { handleEvent },
      });

      await expect(
        subscriber.handle(
          conversationStartedEvent({ id: "evt_conv", occurredAt: T0 }),
          subscriberContext,
        ),
      ).rejects.toThrow(/revision conflict/);
    });
  });

  describe("given a live process service behind the subscriber", () => {
    let store: InMemoryProcessStore;
    let subscriber: ReturnType<typeof createLangyProcessSubscriber>;

    beforeEach(() => {
      store = new InMemoryProcessStore();
      subscriber = createLangyProcessSubscriber({
        processManager: new ProcessManagerService({
          definition: langyConversationProcessDefinition,
          store,
        }),
        clock: () => FIXED_NOW,
      });
    });

    async function subscribeAll(events: LangyConversationProcessingEvent[]) {
      for (const event of events) {
        await subscriber.handle(event, subscriberContext);
      }
    }

    it("folds queued events and makes their durable intents dispatchable", async () => {
      await subscribeAll(lifecycleHistory());

      const instance =
        await store.findByRef<LangyConversationProcessState>({ ref });
      expect(instance?.state).toMatchObject({
        currentTurnId: null,
        turnStatus: "completed",
        autoTitleRequested: true,
      });

      const messages = await store.findMessagesByRef({ ref });
      expect(messages.map((m) => m.messageKey)).toEqual([
        "dispatch:turn_1",
        "title:turn_1",
      ]);
      const { ports, calls } = createStubLangyEffectPorts();
      const dispatcher = new OutboxDispatcherService({
        store,
        handlers: createLangyIntentHandlers({ ports }),
      });
      const report = await dispatcher.runOnce({ now: FIXED_NOW + 60_000 });
      expect(report.dispatched).toEqual([
        "dispatch:turn_1",
        "title:turn_1",
      ]);
      expect(calls.dispatchedTurns).toHaveLength(1);
      expect(calls.titleRequests).toHaveLength(1);
    });

    it("handles duplicate queue delivery exactly once", async () => {
      const history = lifecycleHistory();
      await subscribeAll(history);
      await subscribeAll(history);

      const messages = await store.findMessagesByRef({ ref });
      expect(messages.map((m) => m.messageKey)).toEqual([
        "dispatch:turn_1",
        "title:turn_1",
      ]);
    });

    it("matches direct process evolution and remains wake- and fail-free", async () => {
      await subscribeAll(lifecycleHistory());

      const liveStore = new InMemoryProcessStore();
      const liveService = new ProcessManagerService({
        definition: langyConversationProcessDefinition,
        store: liveStore,
      });
      for (const event of lifecycleHistory()) {
        await liveService.handleEvent({
          envelope: toLangyProcessEnvelope(event),
          now: FIXED_NOW,
        });
      }

      const subscriberInstance =
        await store.findByRef<LangyConversationProcessState>({ ref });
      const liveInstance =
        await liveStore.findByRef<LangyConversationProcessState>({ ref });
      expect(subscriberInstance?.state).toEqual(liveInstance?.state);

      expect(
        await store.findDueWakes({ now: Number.MAX_SAFE_INTEGER, limit: 10 }),
      ).toEqual([]);
      const messages = await store.findMessagesByRef({ ref });
      expect(
        messages.filter((m) => m.intentType.includes("fail")),
      ).toHaveLength(0);
    });
  });
});
