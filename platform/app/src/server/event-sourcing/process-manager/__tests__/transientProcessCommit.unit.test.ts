/**
 * The transient commit path: an evolution that keeps the initial state and
 * arms no wake writes its intents and nothing else — no instance row, no
 * inbox row, no transaction — while the same process still commits durably
 * for the keys that hold something.
 *
 * These are the properties the absent transaction rests on, so they are
 * asserted through the real builder, service and store rather than by
 * reading the flag back.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Event } from "~/server/event-sourcing/domain/types";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  ProcessDefinition,
  ProcessEventEnvelope,
} from "../processManager.types";
import { ProcessManagerService } from "../processManagerService";
import { buildProcessDefinition } from "../processRuntime";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore";

const PROCESS_NAME = "transientProbe";
const PROJECT = "project-1";
/** The registry's one test event type; the probe branches on its payload
 *  rather than declaring event types the pipeline schema does not know. */
const PROBE_EVENT = "test.integration.event";

type ProbeMode = "note" | "remember";

interface ProbeState {
  remembered: string | null;
}

const INITIAL: ProbeState = { remembered: null };

/**
 * A process with both shapes on purpose: a `note` emits an intent and keeps
 * the initial state (transient), a `remember` stores something (durable).
 * That is exactly webhookDelivery's shape — per-request keys that hold
 * nothing, per-endpoint keys that hold a buffer.
 */
function buildProbe(
  handle: (
    state: ProbeState,
    data: { id: string; mode: ProbeMode },
    ctx: {
      intents: { act: (key: string, payload: { id: string }) => unknown };
    },
  ) => { state: ProbeState; intents?: unknown[] } = probeHandler,
): ProcessDefinition<ProbeState> {
  return buildProcessDefinition(
    buildProcessManager<Event>({
      name: PROCESS_NAME,
      applier: (pm) =>
        pm
          .state<ProbeState>(INITIAL)
          .intent("act", z.object({ id: z.string() }), async () => undefined)
          .on(PROBE_EVENT, handle as never)
          .transient(),
    }).config,
  ) as ProcessDefinition<ProbeState>;
}

function probeHandler(
  state: ProbeState,
  data: { id: string; mode: ProbeMode },
  ctx: { intents: { act: (key: string, payload: { id: string }) => unknown } },
): { state: ProbeState; intents?: unknown[] } {
  if (data.mode === "remember") return { state: { remembered: data.id } };
  return { state, intents: [ctx.intents.act("act:noted", { id: data.id })] };
}

let store: InMemoryProcessStore;
let service: ProcessManagerService<ProbeState>;

function envelope(mode: ProbeMode, key: string): ProcessEventEnvelope {
  return {
    eventId: `${mode}:${key}`,
    eventType: PROBE_EVENT,
    occurredAt: 1_000,
    tenantId: PROJECT,
    projectId: PROJECT,
    processKey: key,
    payload: { id: key, mode },
  };
}

function refFor(key: string) {
  return { processName: PROCESS_NAME, projectId: PROJECT, processKey: key };
}

beforeEach(() => {
  store = new InMemoryProcessStore();
  service = new ProcessManagerService<ProbeState>({
    store,
    definition: buildProbe(),
  });
});

describe("transient process commits", () => {
  describe("when an evolution keeps the initial state and arms no wake", () => {
    /** @scenario A transient evolution writes its intents and no process instance */
    it("enqueues the intent and writes no instance row", async () => {
      const result = await service.handleEvent({
        envelope: envelope("note", "req-1"),
        now: 2_000,
      });

      expect(result.outcome).toBe("committed");
      expect(await store.findByRef({ ref: refFor("req-1") })).toBeNull();
      const messages = await store.findMessagesByRef({ ref: refFor("req-1") });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.messageKey).toBe("process:req-1:act:noted");
    });

    /** @scenario A redelivered event re-derives the same key and enqueues nothing new */
    it("suppresses a redelivery without an inbox marker", async () => {
      await service.handleEvent({
        envelope: envelope("note", "req-2"),
        now: 2_000,
      });
      const second = await service.handleEvent({
        envelope: envelope("note", "req-2"),
        now: 3_000,
      });

      // Committed rather than duplicateEvent: with no inbox marker the
      // outbox's own uniqueness is what absorbs the redelivery, and it
      // reports the suppression instead of the commit refusing outright.
      expect(second.outcome).toBe("committed");
      if (second.outcome === "committed") {
        expect(second.insertedMessageKeys).toEqual([]);
        expect(second.duplicateMessageKeys).toEqual([
          "process:req-2:act:noted",
        ]);
      }
      expect(
        await store.findMessagesByRef({ ref: refFor("req-2") }),
      ).toHaveLength(1);
      expect(await store.findByRef({ ref: refFor("req-2") })).toBeNull();
    });

    /** @scenario An evolution with nothing to say writes nothing at all */
    it("writes nothing when the evolution mints no intent", async () => {
      const silent = new ProcessManagerService<ProbeState>({
        store,
        // Keeps the initial state AND mints nothing, so there is no inbox
        // row, no instance row and no outbox row to write.
        definition: buildProbe((state) => ({ state })),
      });

      await silent.handleEvent({
        envelope: envelope("note", "req-3"),
        now: 2_000,
      });

      expect(await store.findByRef({ ref: refFor("req-3") })).toBeNull();
      expect(
        await store.findMessagesByRef({ ref: refFor("req-3") }),
      ).toHaveLength(0);
    });
  });

  describe("when the same process holds state for a key", () => {
    /** @scenario A process manager may be transient for one key and durable for another */
    it("commits an instance row durably", async () => {
      await service.handleEvent({
        envelope: envelope("remember", "endpoint-1"),
        now: 2_000,
      });

      const instance = await store.findByRef<ProbeState>({
        ref: refFor("endpoint-1"),
      });
      expect(instance?.state.remembered).toBe("endpoint-1");
      expect(instance?.revision).toBe(1);
    });

    /** @scenario The durable path keeps its inbox marker, so a redelivery is a no-op */
    it("refuses a redelivered event on the durable path", async () => {
      await service.handleEvent({
        envelope: envelope("remember", "endpoint-2"),
        now: 2_000,
      });
      const second = await service.handleEvent({
        envelope: envelope("remember", "endpoint-2"),
        now: 3_000,
      });

      expect(second.outcome).toBe("duplicateEvent");
    });
  });

  describe("when a transient process also declares a schedule", () => {
    /** @scenario A transient process cannot be scheduled */
    it("refuses to build", () => {
      expect(() =>
        buildProcessManager<Event>({
          name: PROCESS_NAME,
          applier: (pm) =>
            pm
              .state<ProbeState>(INITIAL)
              .intent(
                "act",
                z.object({ id: z.string() }),
                async () => undefined,
              )
              .on(PROBE_EVENT, (state) => ({ state }))
              .transient()
              .schedule({ everyMs: 1_000 }) as never,
        }),
      ).toThrow(/transient and scheduled/);
    });
  });
});
