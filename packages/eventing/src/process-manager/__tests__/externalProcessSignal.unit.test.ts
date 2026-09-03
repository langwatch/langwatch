import { beforeEach, describe, expect, it } from "vitest";

import type {
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessRef,
  ProcessSignalEnvelope,
} from "../processManager.types";
import { ProcessManagerService } from "../processManagerService";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore";

const T0 = Date.UTC(2026, 7, 22, 12, 0, 0);
const ref: ProcessRef = {
  processName: "writeLifecycle",
  projectId: "project-1",
  processKey: "operation-1",
};

type LifecycleState =
  | { status: "unseen"; generation: number }
  | { status: "pending"; generation: number }
  | { status: "confirming"; generation: number }
  | { status: "expired"; generation: number };

function event(): ProcessEventEnvelope {
  return {
    eventId: "write-requested-1",
    eventType: "write_requested",
    occurredAt: T0,
    tenantId: "organization-1",
    projectId: ref.projectId,
    processKey: ref.processKey,
    payload: {},
  };
}

function signal(overrides: Partial<ProcessSignalEnvelope> = {}) {
  return {
    signalId: "confirm-1",
    signalType: "begin_confirmation",
    occurredAt: T0 + 1,
    projectId: ref.projectId,
    processKey: ref.processKey,
    payload: { generation: 1 },
    ...overrides,
  } satisfies ProcessSignalEnvelope;
}

function definition(): ProcessDefinition<LifecycleState> {
  return {
    name: ref.processName,
    initialState: { status: "unseen", generation: 0 },
    evolve: ({ previousState, input }) => {
      if (input.kind === "event") {
        return {
          state: { status: "pending", generation: 1 },
          nextWakeAt: T0 + 30 * 60_000,
          intents: [],
        };
      }
      if (previousState.status !== "pending") {
        return { state: previousState, nextWakeAt: null, intents: [] };
      }
      return {
        state: {
          status: "expired",
          generation: previousState.generation,
        },
        nextWakeAt: null,
        intents: [
          {
            messageKey: `expire:${previousState.generation}`,
            intentType: "expire",
            payload: { generation: previousState.generation },
          },
        ],
      };
    },
    evolveSignal: ({ previousState, signal: inputSignal }) => {
      if (inputSignal.signalType !== "begin_confirmation") {
        throw new Error(`unexpected signal ${inputSignal.signalType}`);
      }
      if (previousState.status !== "pending") {
        throw new Error(`cannot confirm ${previousState.status}`);
      }
      const generation = (inputSignal.payload as { generation: number }).generation;
      return {
        state: { status: "confirming", generation },
        nextWakeAt: null,
        intents: [
          {
            messageKey: `promote:${generation}`,
            intentType: "promote",
            payload: { generation },
          },
        ],
      };
    },
  };
}

async function initialize(service: ProcessManagerService<LifecycleState>): Promise<void> {
  const initialized = await service.handleEvent({ envelope: event(), now: T0 });
  expect(initialized.outcome).toBe("committed");
}

describe("synchronous external process signals", () => {
  let store: InMemoryProcessStore;
  let service: ProcessManagerService<LifecycleState>;

  beforeEach(() => {
    store = InMemoryProcessStore.createForTesting();
    service = new ProcessManagerService({ definition: definition(), store });
  });

  describe("given no durable process instance", () => {
    it("does not let a signal create one", async () => {
      const result = await service.handleSignal({
        signal: signal(),
        now: T0 + 1,
      });

      expect(result).toEqual({ outcome: "processNotFound" });
      expect(await store.findByRef({ ref })).toBeNull();
    });

    it("can explicitly establish a signal-owned lifecycle under revision zero CAS", async () => {
      const gateDefinition = definition();
      gateDefinition.evolveSignal = ({ previousState }) => ({
        state: { status: "pending", generation: previousState.generation + 1 },
        nextWakeAt: null,
        intents: [],
      });
      const gate = new ProcessManagerService({
        definition: gateDefinition,
        store,
      });

      const first = await gate.handleSignal({
        signal: signal(),
        now: T0 + 1,
        createIfMissing: true,
      });
      const retry = await gate.handleSignal({
        signal: signal(),
        now: T0 + 2,
        createIfMissing: true,
      });

      expect(first).toMatchObject({
        outcome: "committed",
        revision: 1,
        state: { status: "pending", generation: 1 },
      });
      expect(retry).toMatchObject({
        outcome: "duplicateSignal",
        revision: 1,
      });
    });
  });

  describe("given a pending process", () => {
    beforeEach(async () => {
      await initialize(service);
    });

    it("commits state, clears its wake and inserts its intent atomically", async () => {
      const result = await service.handleSignal({
        signal: signal(),
        now: T0 + 1,
      });

      expect(result).toMatchObject({
        outcome: "committed",
        revision: 2,
        state: { status: "confirming", generation: 1 },
        insertedMessageKeys: ["promote:1"],
      });
      expect(await store.findByRef({ ref })).toMatchObject({
        revision: 2,
        state: { status: "confirming", generation: 1 },
        nextWakeAt: null,
      });
      expect(await store.findMessagesByRef({ ref })).toEqual([
        expect.objectContaining({
          messageKey: "promote:1",
          intentType: "promote",
          sourceEventId: "external-signal:confirm-1",
          status: "pending",
        }),
      ]);
    });

    it("recovers a lost response without evolving the same signal twice", async () => {
      await service.handleSignal({ signal: signal(), now: T0 + 1 });

      // A new service models a restarted request handler that did not receive
      // the first response but shares the durable process store.
      const restarted = new ProcessManagerService({
        definition: definition(),
        store,
      });
      const result = await restarted.handleSignal({
        signal: signal(),
        now: T0 + 2,
      });

      expect(result).toEqual({
        outcome: "duplicateSignal",
        revision: 2,
        state: { status: "confirming", generation: 1 },
      });
      expect(await store.findMessagesByRef({ ref })).toHaveLength(1);
    });

    it("reloads and retries when another commit wins the first revision", async () => {
      const originalCommit = store.commit.bind(store);
      let interleaved = false;
      store.commit = async (commit) => {
        if (!interleaved && commit.sourceEventId?.startsWith("external-signal:")) {
          interleaved = true;
          await originalCommit({
            ref,
            tenantId: "organization-1",
            sourceEventId: "competing-event",
            expectedRevision: 1,
            state: { status: "pending", generation: 2 },
            nextWakeAt: T0 + 30 * 60_000,
            messages: [],
            now: T0 + 1,
          });
        }
        return await originalCommit(commit);
      };

      const result = await service.handleSignal({
        signal: signal({ payload: { generation: 2 } }),
        now: T0 + 2,
      });

      expect(result).toMatchObject({
        outcome: "committed",
        revision: 3,
        state: { status: "confirming", generation: 2 },
      });
      expect(await store.findMessagesByRef({ ref })).toEqual([
        expect.objectContaining({ messageKey: "promote:2" }),
      ]);
    });

    it("returns the winning state when its configured retry budget is exhausted", async () => {
      const noRetryService = new ProcessManagerService({
        definition: definition(),
        store,
        signalRevisionRetries: 0,
      });
      const originalCommit = store.commit.bind(store);
      let interleaved = false;
      store.commit = async (commit) => {
        if (!interleaved && commit.sourceEventId?.startsWith("external-signal:")) {
          interleaved = true;
          await originalCommit({
            ref,
            tenantId: "organization-1",
            sourceEventId: "competing-event",
            expectedRevision: 1,
            state: { status: "pending", generation: 2 },
            nextWakeAt: T0 + 30 * 60_000,
            messages: [],
            now: T0 + 1,
          });
        }
        return await originalCommit(commit);
      };

      const result = await noRetryService.handleSignal({
        signal: signal(),
        now: T0 + 2,
      });

      expect(result).toEqual({
        outcome: "revisionConflict",
        actualRevision: 2,
        state: { status: "pending", generation: 2 },
      });
      expect(await store.findMessagesByRef({ ref })).toHaveLength(0);
    });

    it("applies concurrent delivery of one signal identity exactly once", async () => {
      const [first, second] = await Promise.all([
        service.handleSignal({ signal: signal(), now: T0 + 1 }),
        service.handleSignal({ signal: signal(), now: T0 + 1 }),
      ]);

      expect([first.outcome, second.outcome].sort()).toEqual([
        "committed",
        "duplicateSignal",
      ]);
      expect(await store.findByRef({ ref })).toMatchObject({ revision: 2 });
      expect(await store.findMessagesByRef({ ref })).toHaveLength(1);
    });
  });

  describe.each(["signal", "wake"] as const)(
    "given %s reaches the revision fence first",
    (firstInput) => {
      it("allows exactly one transition out of pending", async () => {
        await initialize(service);

        const originalFindByRef = store.findByRef.bind(store);
        let synchronizedReads = 0;
        let releaseReads!: () => void;
        const readsReleased = new Promise<void>((resolve) => {
          releaseReads = resolve;
        });
        store.findByRef = async <State = unknown>(params: { ref: ProcessRef }) => {
          const result = await originalFindByRef<State>(params);
          if (synchronizedReads < 2) {
            synchronizedReads++;
            if (synchronizedReads === 2) releaseReads();
            await readsReleased;
          }
          return result;
        };

        const runSignal = () =>
          service.handleSignal({ signal: signal(), now: T0 + 30 * 60_000 });
        const runWake = () =>
          service.handleWake({
            wake: {
              ref,
              revision: 1,
              wakeAt: T0 + 30 * 60_000,
            },
            now: T0 + 30 * 60_000,
          });
        const operations =
          firstInput === "signal" ? [runSignal(), runWake()] : [runWake(), runSignal()];

        await Promise.allSettled(operations);

        const instance = await store.findByRef<LifecycleState>({ ref });
        expect(["confirming", "expired"]).toContain(instance?.state.status);
        const messages = await store.findMessagesByRef({ ref });
        expect(messages).toHaveLength(1);
        expect(["promote", "expire"]).toContain(messages[0]?.intentType);
        if (instance?.state.status === "confirming") {
          expect(messages[0]?.intentType).toBe("promote");
        } else {
          expect(messages[0]?.intentType).toBe("expire");
        }
      });
    },
  );
});
