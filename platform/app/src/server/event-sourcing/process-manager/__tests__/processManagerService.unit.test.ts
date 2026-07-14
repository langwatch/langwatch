import { beforeEach, describe, expect, it } from "vitest";

import { JsonSafetyError } from "../json";
import { ProcessManagerService } from "../processManagerService";
import type { ProcessDefinition, ProcessRef } from "../processManager.types";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore";
import {
  CONVERSATION_ID,
  LIVENESS_MS,
  pilotDefinition,
  pilotEvent,
  pilotRef,
  RETRY_WINDOW_MS,
  T0,
  type PilotState,
} from "./helpers/pilotProcess.fixture";

describe("ProcessManagerService", () => {
  let store: InMemoryProcessStore;
  let service: ProcessManagerService<PilotState>;

  beforeEach(() => {
    store = new InMemoryProcessStore();
    service = new ProcessManagerService({
      definition: pilotDefinition,
      store,
    });
  });

  describe("given a conversation process with no turn in flight", () => {
    describe("when it consumes an agent-response-started event", () => {
      it("records the turn as running with a first revision", async () => {
        const result = await service.handleEvent({
          envelope: pilotEvent({ eventId: "evt_start" }),
          now: T0,
        });

        expect(result.outcome).toBe("committed");
        const instance = await store.findByRef({ ref: pilotRef });
        expect(instance?.revision).toBe(1);
        expect(instance?.state).toMatchObject({
          turnId: "turn_1",
          status: "running",
          dispatchGeneration: 1,
        });
      });

      it("records exactly one worker-dispatch intent with a deterministic message key", async () => {
        await service.handleEvent({
          envelope: pilotEvent({ eventId: "evt_start" }),
          now: T0,
        });

        const messages = await store.findMessagesByRef({ ref: pilotRef });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
          messageKey: "dispatch:turn_1:1",
          intentType: "worker-dispatch",
          sourceEventId: "evt_start",
          status: "pending",
        });
      });

      it("schedules a liveness wake-up", async () => {
        await service.handleEvent({
          envelope: pilotEvent({ eventId: "evt_start" }),
          now: T0,
        });

        const instance = await store.findByRef({ ref: pilotRef });
        expect(instance?.nextWakeAt).toBe(T0 + LIVENESS_MS);
        const wakes = await store.findDueWakes({
          now: T0 + LIVENESS_MS,
          limit: 10,
        });
        expect(wakes).toEqual([
          { ref: pilotRef, revision: 1, wakeAt: T0 + LIVENESS_MS },
        ]);
      });
    });
  });

  describe("given a started-turn event was already consumed", () => {
    beforeEach(async () => {
      await service.handleEvent({
        envelope: pilotEvent({ eventId: "evt_start" }),
        now: T0,
      });
    });

    describe("when the same event is delivered again", () => {
      it("reports a duplicate-event no-op", async () => {
        const result = await service.handleEvent({
          envelope: pilotEvent({ eventId: "evt_start" }),
          now: T0 + 5,
        });
        expect(result.outcome).toBe("duplicateEvent");
      });

      it("changes process state only once", async () => {
        await service.handleEvent({
          envelope: pilotEvent({ eventId: "evt_start" }),
          now: T0 + 5,
        });
        const instance = await store.findByRef({ ref: pilotRef });
        expect(instance?.revision).toBe(1);
      });

      it("keeps exactly one logical worker-dispatch intent", async () => {
        await service.handleEvent({
          envelope: pilotEvent({ eventId: "evt_start" }),
          now: T0 + 5,
        });
        const messages = await store.findMessagesByRef({ ref: pilotRef });
        expect(messages).toHaveLength(1);
      });
    });
  });

  describe("given an agent turn is running", () => {
    beforeEach(async () => {
      await service.handleEvent({
        envelope: pilotEvent({ eventId: "evt_start" }),
        now: T0,
      });
    });

    describe("when a durable tool event is committed for that turn", () => {
      const toolAt = T0 + 10_000;

      beforeEach(async () => {
        await service.handleEvent({
          envelope: pilotEvent({
            eventId: "evt_tool",
            eventType: "langy.turn.tool-completed",
            occurredAt: toolAt,
            payload: { turnId: "turn_1", toolCallId: "call_1" },
          }),
          now: toolAt,
        });
      });

      it("records the newer activity", async () => {
        const instance = await store.findByRef<PilotState>({ ref: pilotRef });
        expect(instance?.state.lastActivityAt).toBe(toolAt);
        expect(instance?.nextWakeAt).toBe(toolAt + LIVENESS_MS);
      });

      it("supersedes the previous liveness wake-up by revision", async () => {
        const result = await service.handleWake({
          wake: { ref: pilotRef, revision: 1, wakeAt: T0 + LIVENESS_MS },
          now: T0 + LIVENESS_MS,
        });
        expect(result.outcome).toBe("staleWake");
        const messages = await store.findMessagesByRef({ ref: pilotRef });
        expect(messages.map((m) => m.messageKey)).toEqual([
          "dispatch:turn_1:1",
        ]);
      });
    });

    describe("when its liveness wake-up fires with the current revision", () => {
      it("commits a new idempotent dispatch generation and reschedules", async () => {
        const wakeAt = T0 + LIVENESS_MS;
        const result = await service.handleWake({
          wake: { ref: pilotRef, revision: 1, wakeAt },
          now: wakeAt,
        });

        expect(result.outcome).toBe("committed");
        const instance = await store.findByRef<PilotState>({ ref: pilotRef });
        expect(instance?.state.dispatchGeneration).toBe(2);
        expect(instance?.nextWakeAt).toBe(wakeAt + LIVENESS_MS);
        const messages = await store.findMessagesByRef({ ref: pilotRef });
        expect(messages.map((m) => m.messageKey)).toEqual([
          "dispatch:turn_1:1",
          "dispatch:turn_1:2",
        ]);
      });
    });

    describe("when wake-ups fire past the retry deadline more than once", () => {
      it("records exactly one logical fail intent", async () => {
        const deadline = T0 + RETRY_WINDOW_MS;

        const first = await service.handleWake({
          wake: { ref: pilotRef, revision: 1, wakeAt: deadline },
          now: deadline,
        });
        expect(first.outcome).toBe("committed");

        // A redelivered wake for the old revision stands down.
        const redelivered = await service.handleWake({
          wake: { ref: pilotRef, revision: 1, wakeAt: deadline },
          now: deadline + 1,
        });
        expect(redelivered.outcome).toBe("staleWake");

        const failMessages = (
          await store.findMessagesByRef({ ref: pilotRef })
        ).filter((m) => m.intentType === "fail-agent-response");
        expect(failMessages).toHaveLength(1);
        expect(failMessages[0]?.messageKey).toBe("fail:turn_1");
      });
    });
  });

  describe("given a turn completed and its response event was consumed", () => {
    beforeEach(async () => {
      await service.handleEvent({
        envelope: pilotEvent({ eventId: "evt_start" }),
        now: T0,
      });
      await service.handleEvent({
        envelope: pilotEvent({
          eventId: "evt_done",
          eventType: "langy.agent-response.completed",
          occurredAt: T0 + 20_000,
          payload: { turnId: "turn_1" },
        }),
        now: T0 + 20_000,
      });
    });

    describe("when an older liveness wake-up fires", () => {
      it("makes no state change and records no failure intent", async () => {
        const before = await store.findByRef({ ref: pilotRef });
        const result = await service.handleWake({
          wake: { ref: pilotRef, revision: 1, wakeAt: T0 + LIVENESS_MS },
          now: T0 + LIVENESS_MS,
        });

        expect(result.outcome).toBe("staleWake");
        const after = await store.findByRef({ ref: pilotRef });
        expect(after).toEqual(before);
        const failMessages = (
          await store.findMessagesByRef({ ref: pilotRef })
        ).filter((m) => m.intentType === "fail-agent-response");
        expect(failMessages).toHaveLength(0);
      });
    });

    describe("when the completed turn had a derived title source", () => {
      it("records one title intent keyed to the turn", async () => {
        const titles = (
          await store.findMessagesByRef({ ref: pilotRef })
        ).filter((m) => m.intentType === "title-generation");
        expect(titles.map((m) => m.messageKey)).toEqual(["title:turn_1"]);
      });
    });
  });

  describe("given I renamed the conversation", () => {
    beforeEach(async () => {
      await service.handleEvent({
        envelope: pilotEvent({
          eventId: "evt_rename",
          eventType: "langy.conversation.renamed",
          payload: { title: "My conversation" },
        }),
        now: T0,
      });
    });

    describe("when later completed turns reach the conversation process", () => {
      it("records no automatic title intent", async () => {
        await service.handleEvent({
          envelope: pilotEvent({ eventId: "evt_start" }),
          now: T0 + 1_000,
        });
        await service.handleEvent({
          envelope: pilotEvent({
            eventId: "evt_done",
            eventType: "langy.agent-response.completed",
            occurredAt: T0 + 5_000,
            payload: { turnId: "turn_1" },
          }),
          now: T0 + 5_000,
        });

        const titles = (
          await store.findMessagesByRef({ ref: pilotRef })
        ).filter((m) => m.intentType === "title-generation");
        expect(titles).toHaveLength(0);
      });
    });
  });

  describe("given two distinct events evolve into the same message key", () => {
    it("stores one message and reports the duplicate key", async () => {
      const sameKeyDefinition: ProcessDefinition<{ seen: number }> = {
        name: "sameKey",
        initialState: { seen: 0 },
        evolve: ({ previousState }) => ({
          state: { seen: previousState.seen + 1 },
          nextWakeAt: null,
          intents: [
            {
              messageKey: "only-once",
              intentType: "noop",
              payload: {},
            },
          ],
        }),
      };
      const sameKeyService = new ProcessManagerService({
        definition: sameKeyDefinition,
        store,
      });
      const ref = { ...pilotRef, processName: "sameKey" };

      const first = await sameKeyService.handleEvent({
        envelope: pilotEvent({ eventId: "evt_a" }),
        now: T0,
      });
      const second = await sameKeyService.handleEvent({
        envelope: pilotEvent({ eventId: "evt_b" }),
        now: T0 + 1,
      });

      expect(first.outcome).toBe("committed");
      expect(second.outcome).toBe("committed");
      if (second.outcome === "committed") {
        expect(second.duplicateMessageKeys).toEqual(["only-once"]);
      }
      const messages = await store.findMessagesByRef({ ref });
      expect(messages).toHaveLength(1);
      const instance = await store.findByRef({ ref });
      expect(instance?.state).toEqual({ seen: 2 });
    });
  });

  describe("given the definition returns non-JSON-safe state", () => {
    it("throws and commits nothing", async () => {
      const badDefinition: ProcessDefinition<{ at: Date | null }> = {
        name: "bad",
        initialState: { at: null },
        evolve: () => ({
          state: { at: new Date(T0) },
          nextWakeAt: null,
          intents: [],
        }),
      };
      const badService = new ProcessManagerService({
        definition: badDefinition,
        store,
      });

      await expect(
        badService.handleEvent({
          envelope: pilotEvent({ eventId: "evt_bad" }),
          now: T0,
        }),
      ).rejects.toBeInstanceOf(JsonSafetyError);
      expect(
        await store.findByRef({ ref: { ...pilotRef, processName: "bad" } }),
      ).toBeNull();
    });
  });

  describe("given a concurrent commit bumps the revision mid-handling", () => {
    it("reports a revision conflict without corrupting state", async () => {
      await service.handleEvent({
        envelope: pilotEvent({ eventId: "evt_start" }),
        now: T0,
      });

      // Interleave a competing commit between the service's read and write.
      const originalFindByRef = store.findByRef.bind(store);
      let interleaved = false;
      store.findByRef = async <State = unknown>(params: {
        ref: ProcessRef;
      }) => {
        const result = await originalFindByRef<State>(params);
        if (!interleaved) {
          interleaved = true;
          await store.commit({
            ref: pilotRef,
            tenantId: "tenant_1",
            sourceEventId: "evt_competing",
            expectedRevision: 1,
            state: result!.state,
            nextWakeAt: null,
            messages: [],
            now: T0 + 1,
          });
        }
        return result;
      };

      const result = await service.handleEvent({
        envelope: pilotEvent({
          eventId: "evt_tool",
          eventType: "langy.turn.tool-completed",
          occurredAt: T0 + 10,
          payload: { turnId: "turn_1" },
        }),
        now: T0 + 10,
      });

      expect(result.outcome).toBe("revisionConflict");
      const instance = await store.findByRef({ ref: pilotRef });
      expect(instance?.revision).toBe(2);
    });
  });

  describe("given events for different conversations", () => {
    it("keeps process state isolated per process key", async () => {
      await service.handleEvent({
        envelope: pilotEvent({ eventId: "evt_a", processKey: CONVERSATION_ID }),
        now: T0,
      });
      await service.handleEvent({
        envelope: pilotEvent({
          eventId: "evt_b",
          processKey: "conv_2",
          payload: { turnId: "turn_9" },
        }),
        now: T0,
      });

      const first = await store.findByRef<PilotState>({ ref: pilotRef });
      const second = await store.findByRef<PilotState>({
        ref: { ...pilotRef, processKey: "conv_2" },
      });
      expect(first?.state.turnId).toBe("turn_1");
      expect(second?.state.turnId).toBe("turn_9");
      expect(second?.revision).toBe(1);
    });
  });
});
