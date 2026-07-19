import { beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryProcessStore,
  ProcessManagerService,
  type ProcessRef,
} from "~/server/event-sourcing/process-manager";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import { buildProcessDefinition } from "~/server/event-sourcing/process-manager/processRuntime";
import type { ProcessDefinition } from "~/server/event-sourcing/process-manager";

import { langyConversationProcess } from "../langyConversationProcess";
import { createStubLangyEffectPorts } from "../langyEffectPorts";
import {
  LANGY_CONVERSATION_PROCESS_NAME,
  LANGY_PROCESS_INTENT_TYPES,
  type LangyConversationProcessState,
} from "../langyConversationProcess.types";
import {
  agentRespondedEvent,
  agentResponseFailedEvent,
  agentTurnAcceptedEvent,
  conversationArchivedEvent,
  messageRecordedEvent,
  conversationRenamedEvent,
  conversationStartedEvent,
  CONVERSATION_ID,
  handoffConsumedEvent,
  handoffPendingEvent,
  planUpdatedEvent,
  PROJECT_ID,
  SENTINELS,
  T0,
  titleGeneratedEvent,
  toolCallInitiatedEvent,
  toLangyProcessEnvelope,
  toolCallSucceededEvent,
} from "./helpers/langyEventFixtures";

/**
 * The EXACT definition the runtime mounts — built through the pipeline's own
 * `langyConversationProcess` applier and the runtime's
 * `buildProcessDefinition`, so these tests cover the generated evolve
 * (intent-key prefixing, undeclared-event guard, schema-validated intent
 * payloads) rather than a re-implementation. The effect ports are stubs:
 * evolve never dispatches.
 */
const langyConversationProcessDefinition = buildProcessDefinition(
  buildProcessManager<LangyConversationProcessingEvent>({
    name: LANGY_CONVERSATION_PROCESS_NAME,
    applier: langyConversationProcess(createStubLangyEffectPorts().ports),
  }).config,
) as ProcessDefinition<LangyConversationProcessState>;


const ref: ProcessRef = {
  processName: LANGY_CONVERSATION_PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: CONVERSATION_ID,
};

describe("LangyConversationProcess", () => {
  let store: InMemoryProcessStore;
  let service: ProcessManagerService<LangyConversationProcessState>;

  beforeEach(() => {
    store = new InMemoryProcessStore();
    service = new ProcessManagerService({
      definition: langyConversationProcessDefinition,
      store,
    });
  });

  async function deliver(events: LangyConversationProcessingEvent[]) {
    const results = [];
    for (const event of events) {
      results.push(
        await service.handleEvent({
          envelope: toLangyProcessEnvelope(event),
          now: event.occurredAt,
        }),
      );
    }
    return results;
  }

  /** started conversation + user message + agent turn started at T0+10s */
  function startedTurnHistory(turnId = "turn_1") {
    return [
      conversationStartedEvent({ id: "evt_conv", occurredAt: T0 }),
      messageRecordedEvent({ id: "evt_msg", occurredAt: T0 + 1_000 }),
      agentTurnAcceptedEvent({
        id: `evt_started_${turnId}`,
        occurredAt: T0 + 10_000,
        turnId,
      }),
    ];
  }

  async function state(): Promise<LangyConversationProcessState> {
    const instance =
      await store.findByRef<LangyConversationProcessState>({ ref });
    expect(instance).not.toBeNull();
    return instance!.state;
  }

  describe("given an ordered conversation event stream", () => {
    describe("when the agent starts a turn", () => {
      beforeEach(async () => {
        await deliver(startedTurnHistory());
      });

      it("records the turn as running", async () => {
        expect(await state()).toMatchObject({
          currentTurnId: "turn_1",
          turnStatus: "running",
        });
      });

      it("records exactly one typed worker-dispatch intent", async () => {
        const messages = await store.findMessagesByRef({ ref });
        const dispatches = messages.filter(
          (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH,
        );
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toMatchObject({
          messageKey: `process:${CONVERSATION_ID}:dispatch:turn_1`,
          payload: {
            conversationId: CONVERSATION_ID,
            turnId: "turn_1",
            resumeFromTurnId: null,
          },
        });
      });
    });

    describe("when durable tool and plan activity arrives in order", () => {
      it("makes no process decision from turn-progress events", async () => {
        await deliver(startedTurnHistory());
        const runningState = await state();

        await deliver([
          toolCallInitiatedEvent({
            id: "evt_tool_init",
            occurredAt: T0 + 15_000,
            turnId: "turn_1",
          }),
          toolCallSucceededEvent({
            id: "evt_tool_ok",
            occurredAt: T0 + 20_000,
            turnId: "turn_1",
          }),
          planUpdatedEvent({
            id: "evt_plan",
            occurredAt: T0 + 25_000,
            turnId: "turn_1",
          }),
        ]);

        expect(await state()).toEqual(runningState);
        const messages = await store.findMessagesByRef({ ref });
        expect(messages.map((m) => m.messageKey)).toEqual([`process:${CONVERSATION_ID}:dispatch:turn_1`]);
      });
    });

    describe("when the turn completes", () => {
      beforeEach(async () => {
        await deliver([
          ...startedTurnHistory(),
          agentRespondedEvent({
            id: "evt_done",
            occurredAt: T0 + 30_000,
            turnId: "turn_1",
          }),
        ]);
      });

      it("finalizes the turn", async () => {
        expect(await state()).toMatchObject({
          currentTurnId: null,
          turnStatus: "completed",
        });
      });

      it("records one title intent for the derived-placeholder title", async () => {
        const titles = (await store.findMessagesByRef({ ref })).filter(
          (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
        );
        expect(titles).toHaveLength(1);
        expect(titles[0]).toMatchObject({
          messageKey: `process:${CONVERSATION_ID}:title:turn_1`,
          payload: { conversationId: CONVERSATION_ID, turnId: "turn_1" },
        });
      });

      it("evaluated the whole stream into an ordered intent sequence", async () => {
        const messages = await store.findMessagesByRef({ ref });
        expect(messages.map((m) => m.messageKey)).toEqual([
          `process:${CONVERSATION_ID}:dispatch:turn_1`,
          `process:${CONVERSATION_ID}:title:turn_1`,
        ]);
      });
    });
  });

  describe("given liveness is out of this pilot", () => {
    it("never schedules a wake-up across the whole turn lifecycle", async () => {
      await deliver([
        ...startedTurnHistory(),
        toolCallInitiatedEvent({
          id: "evt_tool_init",
          occurredAt: T0 + 15_000,
          turnId: "turn_1",
        }),
        agentRespondedEvent({
          id: "evt_done",
          occurredAt: T0 + 30_000,
          turnId: "turn_1",
        }),
      ]);

      const instance = await store.findByRef({ ref });
      expect(instance?.nextWakeAt).toBeNull();
      const wakes = await store.findDueWakes({
        now: Number.MAX_SAFE_INTEGER,
        limit: 100,
      });
      expect(wakes).toEqual([]);
    });

    it("decides nothing from a forged wake token, even at the current revision", async () => {
      await deliver(startedTurnHistory());
      const instance = await store.findByRef({ ref });
      const before = await state();

      const result = await service.handleWake({
        wake: { ref, revision: instance!.revision, wakeAt: T0 + 60_000 },
        now: T0 + 60_000,
      });

      expect(result.outcome).toBe("committed");
      expect(await state()).toEqual(before);
      const messages = await store.findMessagesByRef({ ref });
      expect(messages.map((m) => m.messageKey)).toEqual([`process:${CONVERSATION_ID}:dispatch:turn_1`]);
    });

    it("emits no fail-turn or redispatch intent, ever", async () => {
      await deliver([
        ...startedTurnHistory(),
        // A turn that never completes — exactly the case the old liveness
        // logic would have re-dispatched and then failed.
      ]);

      const messages = await store.findMessagesByRef({ ref });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.intentType).toBe(
        LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH,
      );
      const intentTypes = Object.values(LANGY_PROCESS_INTENT_TYPES);
      expect(intentTypes.some((t) => t.includes("fail"))).toBe(false);
    });
  });

  describe("given duplicate event delivery", () => {
    it("consumes a redelivered agent-response-started event once", async () => {
      await deliver(startedTurnHistory());
      const [redelivery] = await deliver([
        agentTurnAcceptedEvent({
          id: "evt_started_turn_1",
          occurredAt: T0 + 10_000,
          turnId: "turn_1",
        }),
      ]);

      expect(redelivery?.outcome).toBe("duplicateEvent");
      const dispatches = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH,
      );
      expect(dispatches).toHaveLength(1);
    });

    it("keeps exactly one title intent when the terminal event is redelivered", async () => {
      const done = agentRespondedEvent({
        id: "evt_done",
        occurredAt: T0 + 30_000,
        turnId: "turn_1",
      });
      await deliver([...startedTurnHistory(), done]);
      const [redelivery] = await deliver([done]);

      expect(redelivery?.outcome).toBe("duplicateEvent");
      const titles = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
      );
      expect(titles).toHaveLength(1);
    });
  });

  describe("given automatic titling is a one-shot at the first successful turn", () => {
    function turnCycle(turn: number, at: number) {
      return [
        agentTurnAcceptedEvent({
          id: `evt_started_turn_${turn}`,
          occurredAt: at,
          turnId: `turn_${turn}`,
        }),
        agentRespondedEvent({
          id: `evt_done_turn_${turn}`,
          occurredAt: at + 1_000,
          turnId: `turn_${turn}`,
        }),
      ];
    }

    it("titles the first successful turn even after an earlier failed turn", async () => {
      await deliver([
        conversationStartedEvent({ id: "evt_conv", occurredAt: T0 }),
        agentTurnAcceptedEvent({
          id: "evt_started_turn_1",
          occurredAt: T0 + 1_000,
          turnId: "turn_1",
        }),
        agentResponseFailedEvent({
          id: "evt_failed_turn_1",
          occurredAt: T0 + 2_000,
          turnId: "turn_1",
        }),
        ...turnCycle(2, T0 + 3_000),
      ]);

      const titles = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
      );
      expect(titles.map((m) => m.messageKey)).toEqual([`process:${CONVERSATION_ID}:title:turn_2`]);
    });

    it("does not title a second successful turn while the first request is still in flight", async () => {
      // title:turn_1 was requested but title_generated has not landed yet —
      // titleSource is still "derived". The one-shot latch must hold.
      await deliver([
        conversationStartedEvent({ id: "evt_conv", occurredAt: T0 }),
        ...turnCycle(1, T0 + 1_000),
        ...turnCycle(2, T0 + 3_000),
      ]);

      const titles = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
      );
      expect(titles.map((m) => m.messageKey)).toEqual([`process:${CONVERSATION_ID}:title:turn_1`]);
    });

    it("never retitles once titleSource is auto, regardless of later turns", async () => {
      const events: LangyConversationProcessingEvent[] = [
        conversationStartedEvent({ id: "evt_conv", occurredAt: T0 }),
        ...turnCycle(1, T0 + 1_000),
        titleGeneratedEvent({
          id: "evt_title_auto",
          occurredAt: T0 + 2_500,
          turnId: "turn_1",
        }),
      ];
      for (let turn = 2; turn <= 5; turn++) {
        events.push(...turnCycle(turn, T0 + turn * 2_000));
      }
      await deliver(events);

      expect((await state()).titleSource).toBe("auto");
      const titles = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
      );
      expect(titles.map((m) => m.messageKey)).toEqual([`process:${CONVERSATION_ID}:title:turn_1`]);
    });

    it("records no automatic title after the user renamed the conversation", async () => {
      await deliver([
        conversationStartedEvent({ id: "evt_conv", occurredAt: T0 }),
        conversationRenamedEvent({ id: "evt_rename", occurredAt: T0 + 1_000 }),
        ...turnCycle(1, T0 + 2_000),
      ]);

      expect((await state()).titleSource).toBe("user");
      const titles = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
      );
      expect(titles).toHaveLength(0);
    });
  });

  describe("given a shutdown handoff (ADR-048)", () => {
    beforeEach(async () => {
      await deliver([
        ...startedTurnHistory(),
        handoffPendingEvent({
          id: "evt_handoff",
          occurredAt: T0 + 12_000,
          turnId: "turn_1",
        }),
      ]);
    });

    it("returns the conversation to idle without failing the handed-off turn", async () => {
      expect(await state()).toMatchObject({
        currentTurnId: null,
        turnStatus: "idle",
        pendingHandoffTurnId: "turn_1",
      });
      const messages = await store.findMessagesByRef({ ref });
      expect(messages.map((m) => m.messageKey)).toEqual([`process:${CONVERSATION_ID}:dispatch:turn_1`]);
    });

    it("threads the handed-off turn id into the next dispatch intent, by reference only", async () => {
      await deliver([
        agentTurnAcceptedEvent({
          id: "evt_started_turn_2",
          occurredAt: T0 + 20_000,
          turnId: "turn_2",
        }),
      ]);

      const dispatches = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.messageKey === `process:${CONVERSATION_ID}:dispatch:turn_2`,
      );
      expect(dispatches[0]?.payload).toMatchObject({
        turnId: "turn_2",
        resumeFromTurnId: "turn_1",
      });
    });

    it("clears the pending handoff once consumed", async () => {
      await deliver([
        handoffConsumedEvent({
          id: "evt_handoff_consumed",
          occurredAt: T0 + 19_000,
          turnId: "turn_2",
        }),
        agentTurnAcceptedEvent({
          id: "evt_started_turn_2",
          occurredAt: T0 + 20_000,
          turnId: "turn_2",
        }),
      ]);

      expect((await state()).pendingHandoffTurnId).toBeNull();
      const dispatches = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.messageKey === `process:${CONVERSATION_ID}:dispatch:turn_2`,
      );
      expect(dispatches[0]?.payload).toMatchObject({ resumeFromTurnId: null });
    });
  });

  describe("given the conversation was archived", () => {
    it("dispatches nothing for later turn events", async () => {
      await deliver([
        ...startedTurnHistory(),
        conversationArchivedEvent({ id: "evt_archive", occurredAt: T0 + 12_000 }),
        agentTurnAcceptedEvent({
          id: "evt_started_after_archive",
          occurredAt: T0 + 13_000,
          turnId: "turn_2",
        }),
      ]);

      expect((await state()).archived).toBe(true);
      const dispatches = (await store.findMessagesByRef({ ref })).filter(
        (m) => m.intentType === LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH,
      );
      expect(dispatches.map((m) => m.messageKey)).toEqual([`process:${CONVERSATION_ID}:dispatch:turn_1`]);
    });
  });

  describe("given a failed turn lifecycle", () => {
    it("terminalizes on agent-response-failed without emitting intents", async () => {
      await deliver([
        ...startedTurnHistory(),
        agentResponseFailedEvent({
          id: "evt_failed",
          occurredAt: T0 + 30_000,
          turnId: "turn_1",
        }),
      ]);

      expect(await state()).toMatchObject({
        currentTurnId: null,
        turnStatus: "failed",
      });
      const messages = await store.findMessagesByRef({ ref });
      expect(messages.map((m) => m.messageKey)).toEqual([`process:${CONVERSATION_ID}:dispatch:turn_1`]);
    });
  });

  describe("given redelivery of canonical history", () => {
    const history = () => [
      ...startedTurnHistory(),
      toolCallInitiatedEvent({
        id: "evt_tool_init",
        occurredAt: T0 + 15_000,
        turnId: "turn_1",
      }),
      agentRespondedEvent({
        id: "evt_done",
        occurredAt: T0 + 30_000,
        turnId: "turn_1",
      }),
    ];

    it("redelivering the whole history to the live store folds nothing twice", async () => {
      await deliver(history());
      const before = await store.findByRef({ ref });
      const messagesBefore = await store.findMessagesByRef({ ref });

      const results = await deliver(history());

      expect(results.every((r) => r.outcome === "duplicateEvent")).toBe(true);
      expect(await store.findByRef({ ref })).toEqual(before);
      expect(await store.findMessagesByRef({ ref })).toEqual(messagesBefore);
    });
  });

  describe("given events full of conversation content and secrets", () => {
    it("persists no content, credentials, or tokens in process state or outbox rows", async () => {
      await deliver([
        ...startedTurnHistory(),
        toolCallInitiatedEvent({
          id: "evt_tool_init",
          occurredAt: T0 + 15_000,
          turnId: "turn_1",
        }),
        planUpdatedEvent({
          id: "evt_plan",
          occurredAt: T0 + 16_000,
          turnId: "turn_1",
        }),
        handoffPendingEvent({
          id: "evt_handoff",
          occurredAt: T0 + 17_000,
          turnId: "turn_1",
        }),
        conversationRenamedEvent({ id: "evt_rename", occurredAt: T0 + 18_000 }),
        agentTurnAcceptedEvent({
          id: "evt_started_turn_2",
          occurredAt: T0 + 19_000,
          turnId: "turn_2",
        }),
        agentResponseFailedEvent({
          id: "evt_failed_turn_2",
          occurredAt: T0 + 60_000,
          turnId: "turn_2",
        }),
      ]);

      const persisted = JSON.stringify({
        instance: await store.findByRef({ ref }),
        messages: await store.findMessagesByRef({ ref }),
      });
      for (const sentinel of Object.values(SENTINELS)) {
        expect(persisted).not.toContain(sentinel);
      }
    });
  });
});
