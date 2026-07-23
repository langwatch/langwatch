import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_DISPATCH_TIMEOUT_MS } from "~/server/app-layer/langy/langyWorker";
import {
  InMemoryProcessStore,
  OutboxDispatcherService,
  ProcessManagerService,
  type IntentHandler,
} from "~/server/event-sourcing/process-manager";

import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import { buildProcessDefinition } from "~/server/event-sourcing/process-manager/processRuntime";
import type { ProcessDefinition } from "~/server/event-sourcing/process-manager";

import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import type { LangyConversationProcessState } from "../langyConversationProcess.types";
import { langyConversationProcess } from "../langyConversationProcess";
import { createStubLangyEffectPorts } from "../langyEffectPorts";
import {
  LANGY_CONVERSATION_PROCESS_NAME,
  LANGY_PROCESS_INTENT_TYPES,
} from "../langyConversationProcess.types";
import { LANGY_OUTBOX_LEASE_DURATION_MS } from "../langyEffectPorts";
import {
  agentTurnAcceptedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  T0,
  toLangyProcessEnvelope,
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


const ref = {
  processName: LANGY_CONVERSATION_PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: CONVERSATION_ID,
};

/**
 * The Langy outbox delivers a worker dispatch by calling the manager over HTTP
 * with a budget of {@link AGENT_DISPATCH_TIMEOUT_MS}. If the exclusive lease is
 * shorter than that budget, a healthy long-running dispatch loses its lease
 * MID-FLIGHT: a second dispatcher instance re-leases the row and re-delivers
 * the same intent concurrently, and the original handler's markDispatched is
 * then fenced out by the superseding token — so a persistently slow-but-live
 * effect never retires and redelivers forever. These tests pin the fix: the
 * lease outlives the dispatch budget.
 */
describe("Langy process outbox lease fencing", () => {
  let store: InMemoryProcessStore;

  beforeEach(async () => {
    store = new InMemoryProcessStore();
    const service = new ProcessManagerService({
      definition: langyConversationProcessDefinition,
      store,
    });
    // AGENT_TURN_ACCEPTED enqueues exactly one `dispatch:<turnId>` intent.
    await service.handleEvent({
      envelope: toLangyProcessEnvelope(
        agentTurnAcceptedEvent({
          id: "evt_started",
          occurredAt: T0,
          turnId: "turn_1",
        }),
      ),
      now: T0,
    });
  });

  describe("given a lease shorter than a slow-but-live dispatch", () => {
    it("lets a second instance re-lease and double-deliver the same turn", async () => {
      const delivered: string[] = [];
      let releaseSlow!: () => void;
      const blocked = new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });

      const slowHandler: IntentHandler = async ({ message }) => {
        delivered.push(`A:${message.messageKey}`);
        await blocked;
      };
      const dispatcherA = new OutboxDispatcherService({
        store,
        handlers: { [LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH]: slowHandler },
        leaseDurationMs: 100,
      });

      // A leases the dispatch and blocks inside its handler (a live turn still
      // waiting on the manager).
      const runA = dispatcherA.runOnce({ now: T0, limit: 1 });
      await vi.waitFor(() => expect(delivered).toContain(`A:process:${CONVERSATION_ID}:dispatch:turn_1`));

      const fastHandler = vi.fn<IntentHandler>(async ({ message }) => {
        delivered.push(`B:${message.messageKey}`);
      });
      const dispatcherB = new OutboxDispatcherService({
        store,
        handlers: { [LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH]: fastHandler },
        leaseDurationMs: 100,
      });

      // After the 100ms lease has expired but while A is still in-flight, B
      // re-leases the row and delivers the SAME turn a second time.
      const reportB = await dispatcherB.runOnce({ now: T0 + 200, limit: 1 });
      expect(reportB.dispatched).toEqual([`process:${CONVERSATION_ID}:dispatch:turn_1`]);
      expect(delivered).toEqual([`A:process:${CONVERSATION_ID}:dispatch:turn_1`, `B:process:${CONVERSATION_ID}:dispatch:turn_1`]);

      // A finally completes; its markDispatched is fenced by B's superseding
      // lease, so the double delivery already happened and cannot be undone.
      releaseSlow();
      await runA;
      const messages = await store.findMessagesByRef({ ref });
      expect(messages).toHaveLength(1);
      expect(messages[0]!.status).toBe("dispatched");
    });
  });

  describe("given a lease that outlives a slow-but-live dispatch", () => {
    it("keeps the turn leased so no second instance can re-deliver it", async () => {
      const delivered: string[] = [];
      let releaseSlow!: () => void;
      const blocked = new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });

      const slowHandler: IntentHandler = async ({ message }) => {
        delivered.push(`A:${message.messageKey}`);
        await blocked;
      };
      const dispatcherA = new OutboxDispatcherService({
        store,
        handlers: { [LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH]: slowHandler },
        leaseDurationMs: LANGY_OUTBOX_LEASE_DURATION_MS,
      });

      const runA = dispatcherA.runOnce({ now: T0, limit: 1 });
      await vi.waitFor(() => expect(delivered).toContain(`A:process:${CONVERSATION_ID}:dispatch:turn_1`));

      const fastHandler = vi.fn<IntentHandler>(async ({ message }) => {
        delivered.push(`B:${message.messageKey}`);
      });
      const dispatcherB = new OutboxDispatcherService({
        store,
        handlers: { [LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH]: fastHandler },
        leaseDurationMs: LANGY_OUTBOX_LEASE_DURATION_MS,
      });

      // Even well past the 60s dispatch budget, the lease is still held: B has
      // nothing to lease and never touches the turn.
      const reportB = await dispatcherB.runOnce({
        now: T0 + AGENT_DISPATCH_TIMEOUT_MS + 1_000,
        limit: 1,
      });
      expect(reportB.dispatched).toEqual([]);
      expect(fastHandler).not.toHaveBeenCalled();
      expect(delivered).toEqual([`A:process:${CONVERSATION_ID}:dispatch:turn_1`]);

      releaseSlow();
      await runA;
    });
  });

  describe("given the configured Langy lease window", () => {
    it("outlasts the worker-dispatch budget so a live turn is never re-delivered", () => {
      expect(LANGY_OUTBOX_LEASE_DURATION_MS).toBeGreaterThan(
        AGENT_DISPATCH_TIMEOUT_MS,
      );
    });
  });
});
