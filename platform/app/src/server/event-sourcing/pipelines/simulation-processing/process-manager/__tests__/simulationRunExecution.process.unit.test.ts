import type { ProcessDefinition } from "@langwatch/eventing";
import { buildProcessDefinition, buildProcessManager } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { STALL_THRESHOLD_MS } from "~/server/scenarios/scenario.constants";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

import { SIMULATION_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import { simulationRunExecutionPM } from "../index";
import { buildSimulationRunEventView } from "../simulationRunExecution.process";
import type { SimulationRunExecutionProcessState } from "../simulationRunExecutionProcess.types";
import {
  CANCEL_GRACE_MS,
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  type SimulationRunProcessEventView,
  simulationRunProcessEventViewSchema,
} from "../simulationRunExecutionProcess.types";

const PROJECT_ID = "project-1";
const RUN_ID = "run-1";
const TARGET = { type: "prompt" as const, referenceId: "prompt-1" };

/**
 * The EXACT definition the runtime mounts — built through the pipeline's own
 * `simulationRunExecutionPM` applier and the runtime's `buildProcessDefinition`,
 * so these tests cover the generated evolve (intent-key prefixing, omitted
 * nextWakeAt clearing the wake, undeclared-event guard) rather than a
 * re-implementation. The executors are stubs: evolve never dispatches.
 */
const definition = buildProcessDefinition(
  buildProcessManager<SimulationProcessingEvent>({
    name: SIMULATION_RUN_EXECUTION_PROCESS_NAME,
    applier: simulationRunExecutionPM({
      getPool: () => null,
      publishCancellation: () => Promise.reject(new Error("unused")),
      commands: () => {
        throw new Error("unused in evolve tests");
      },
    }),
  }).config,
) as ProcessDefinition<SimulationRunExecutionProcessState>;

const initialState = definition.initialState;

const REF = {
  processName: SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: RUN_ID,
};

/** Builder-authored intent keys are qualified per process instance. */
function intentKey(localKey: string): string {
  return `process:${encodeURIComponent(RUN_ID)}:${localKey}`;
}

function makeEvent(overrides: {
  type: SimulationProcessingEvent["type"];
  occurredAt?: number;
  data: unknown;
}): SimulationProcessingEvent {
  return {
    id: `evt-${overrides.type}-${overrides.occurredAt ?? 1_000}`,
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: PROJECT_ID,
    createdAt: overrides.occurredAt ?? 1_000,
    occurredAt: overrides.occurredAt ?? 1_000,
    version: "2026-08-06",
    ...overrides,
  } as SimulationProcessingEvent;
}

function queuedData(overrides: Record<string, unknown> = {}) {
  return {
    scenarioRunId: RUN_ID,
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    scenarioSetId: "set-1",
    name: "Test simulation",
    target: TARGET,
    ...overrides,
  };
}

function evolveEvent(
  previousState: SimulationRunExecutionProcessState,
  event: SimulationProcessingEvent,
  /** Handling instant; defaults to prompt delivery. Pass it to model lag. */
  now?: number,
) {
  return definition.evolve({
    previousState,
    input: {
      kind: "event",
      event: {
        eventId: event.id,
        eventType: event.type,
        occurredAt: event.occurredAt,
        tenantId: String(event.tenantId),
        projectId: String(event.tenantId),
        processKey: String(event.aggregateId),
        payload: buildSimulationRunEventView(event),
      },
      now: now ?? event.occurredAt,
    },
    ref: REF,
  });
}

function evolveWake(
  previousState: SimulationRunExecutionProcessState,
  scheduledFor: number,
  now: number = scheduledFor,
) {
  return definition.evolve({
    previousState,
    input: { kind: "wake", scheduledFor, now },
    ref: REF,
  });
}

function queuedState(
  overrides: Partial<SimulationRunExecutionProcessState> = {},
): SimulationRunExecutionProcessState {
  return {
    projectId: PROJECT_ID,
    scenarioRunId: RUN_ID,
    phase: "queued",
    queuedAtMs: 10_000,
    lastActivityAtMs: 10_000,
    cancelRequestedAtMs: null,
    ...overrides,
  };
}

function runningState(
  overrides: Partial<SimulationRunExecutionProcessState> = {},
): SimulationRunExecutionProcessState {
  return queuedState({ phase: "running", ...overrides });
}

/** Recursively collects every object key reachable from a value. */
function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      collectKeys(item, into);
    }
  }
  return into;
}

describe("simulationRunExecution process (runtime-built definition)", () => {
  describe("when a run is queued", () => {
    /** @scenario "Process manager dispatches execute intent on queued event" */
    it("opens the process in queued phase and emits the execute intent", () => {
      const evolution = evolveEvent(
        initialState,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: queuedData(),
        }),
      );

      expect(evolution.state).toEqual({
        projectId: PROJECT_ID,
        scenarioRunId: RUN_ID,
        phase: "queued",
        queuedAtMs: 10_000,
        lastActivityAtMs: 10_000,
        cancelRequestedAtMs: null,
      });
      expect(evolution.intents).toEqual([
        {
          messageKey: intentKey(`execute:${RUN_ID}`),
          intentType: "execute",
          payload: {
            scenarioRunId: RUN_ID,
            projectId: PROJECT_ID,
            scenarioId: "scenario-1",
            batchRunId: "batch-1",
            scenarioSetId: "set-1",
            name: "Test simulation",
            target: TARGET,
          },
        },
      ]);
      expect(evolution.nextWakeAt).toBe(10_000 + STALL_THRESHOLD_MS);
    });

    it("arms the stall wake from the present when the queued event arrives late", () => {
      const occurredAt = 10_000;
      // A backed-up subscriber delivers the queued event an hour late.
      const now = occurredAt + 60 * 60_000;

      const evolution = evolveEvent(
        initialState,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt,
          data: queuedData(),
        }),
        now,
      );

      // Scheduling from business time would write a wake already behind the
      // present, declaring the run stalled the moment the wake worker saw it.
      expect(evolution.nextWakeAt).toBe(now + STALL_THRESHOLD_MS);

      // The stored stamp has to move with it. The wake measures
      // `now - lastActivityAtMs`, so leaving business time here would let the
      // first wake find an hour of "inactivity" on a run that just started —
      // the same bug, one field over.
      expect(evolution.state.lastActivityAtMs).toBe(now);
      // queuedAtMs stays business time: it records when the run was queued,
      // it is not a deadline.
      expect(evolution.state.queuedAtMs).toBe(occurredAt);
    });

    it("finishes the run unexecutable when the queued event carries no target or identity", () => {
      const evolution = evolveEvent(
        initialState,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: { scenarioRunId: RUN_ID },
        }),
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
      expect(evolution.intents).toEqual([
        {
          messageKey: intentKey(`finish:${RUN_ID}:unexecutable`),
          intentType: "finish",
          payload: {
            scenarioRunId: RUN_ID,
            projectId: PROJECT_ID,
            status: ScenarioRunStatus.ERROR,
            error: "queued event carries no execution target",
          },
        },
      ]);
    });

    it("finishes CANCELLED straight away when the cancel was recorded before the queued event", () => {
      // The cancel_requested event reached the process before the queued
      // event did (initial phase is "queued"): the run was never submitted,
      // so the queued-phase cancel path finishes it and a late queued event
      // becomes a redelivery no-op.
      const cancelFirst = evolveEvent(
        initialState,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED,
          occurredAt: 9_000,
          data: { scenarioRunId: RUN_ID },
        }),
      );

      expect(cancelFirst.state.phase).toBe("terminal");
      expect(cancelFirst.intents[0]).toMatchObject({
        messageKey: intentKey(`finish:${RUN_ID}:cancelled`),
        intentType: "finish",
      });

      const lateQueued = evolveEvent(
        cancelFirst.state,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: queuedData(),
        }),
      );

      expect(lateQueued.state).toEqual(cancelFirst.state);
      expect(lateQueued.intents).toEqual([]);
      expect(lateQueued.nextWakeAt).toBeNull();
    });

    /** @scenario "Process manager skips already-cancelled runs" */
    it("never submits to the pool when state already records a cancellation (defensive branch)", () => {
      const evolution = evolveEvent(
        { ...initialState, cancelRequestedAtMs: 9_000 },
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: queuedData(),
        }),
      );

      expect(evolution.state.phase).toBe("cancelling");
      expect(evolution.nextWakeAt).toBe(10_000 + CANCEL_GRACE_MS);
      expect(evolution.intents).toEqual([
        {
          messageKey: intentKey(`finish:${RUN_ID}:cancelled`),
          intentType: "finish",
          payload: {
            scenarioRunId: RUN_ID,
            projectId: PROJECT_ID,
            status: ScenarioRunStatus.CANCELLED,
          },
        },
      ]);
    });

    it("is a no-op when the queued event is redelivered", () => {
      const first = evolveEvent(
        initialState,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: queuedData(),
        }),
      );

      const second = evolveEvent(
        first.state,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 11_000,
          data: queuedData(),
        }),
      );

      expect(second.state).toEqual(first.state);
      expect(second.intents).toEqual([]);
      // The no-op must re-state the wake: an omitted nextWakeAt CLEARS it.
      expect(second.nextWakeAt).toBe(10_000 + STALL_THRESHOLD_MS);
    });
  });

  describe("when the queued event records the run's parameters", () => {
    // The queued event is the only place a run's resolved parameter values
    // cross into execution. Miss this hop and the whole feature is a silent
    // no-op: the values are recorded, the run looks right, and the target
    // under test never sees one.
    function executeIntentFor(metadata?: Record<string, unknown>) {
      const evolution = evolveEvent(
        initialState,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: queuedData(metadata ? { metadata } : {}),
        }),
      );
      const payload = evolution.intents[0]?.payload as
        | Record<string, unknown>
        | undefined;
      return { evolution, payload };
    }

    /** @scenario "Resolved parameter values are recorded on the run and shown in the run detail drawer" */
    it("forwards them onto the execute intent", () => {
      const { evolution, payload } = executeIntentFor({
        langwatch: { targetReferenceId: "agent_1" },
        parameters: { account_tier: "platinum", seats: 12, trial: false },
      });

      expect(evolution.intents).toHaveLength(1);
      expect(payload?.parameters).toEqual({
        account_tier: "platinum",
        seats: 12,
        trial: false,
      });
    });

    it("emits the intent without any when the queued event records none", () => {
      const withOtherMetadata = executeIntentFor({
        langwatch: { targetReferenceId: "agent_1" },
      });
      const withNoMetadata = executeIntentFor();

      expect(withOtherMetadata.payload).not.toHaveProperty("parameters");
      expect(withNoMetadata.payload).not.toHaveProperty("parameters");
    });

    it("runs the scenario without them when the recorded shape is unreadable", () => {
      const { evolution, payload } = executeIntentFor({
        parameters: { "not a name": "value" },
      });

      expect(evolution.intents).toHaveLength(1);
      expect(payload).not.toHaveProperty("parameters");
    });

    it("drops the whole record when only one name is unreadable", () => {
      // All or nothing on purpose. Half a record is the worse failure: the run
      // would go ahead against a value the caller never chose, and read as an
      // agent that answered the wrong question. Nothing at all surfaces as the
      // missing-value error the scenario's own text raises.
      const { evolution, payload } = executeIntentFor({
        parameters: { region: "eu-central", "not a name": "value" },
      });

      expect(evolution.intents).toHaveLength(1);
      expect(payload).not.toHaveProperty("parameters");
    });
  });

  describe("when the queued event records the run's secret parameters", () => {
    // They ride beside the metadata, encrypted, and stay encrypted through
    // this hop: the intent payload is persisted verbatim into outbox rows.
    function executeIntentFor(data: Record<string, unknown>) {
      const evolution = evolveEvent(
        initialState,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: queuedData(data),
        }),
      );
      return evolution.intents[0]?.payload as Record<string, unknown> | undefined;
    }

    /** @scenario "A secret value reaches targets through the secrets namespace" */
    it("forwards them onto the execute intent as they were recorded", () => {
      const payload = executeIntentFor({
        secretParameters: { api_token: "ciphertext-of-tok-live-1" },
      });

      expect(payload?.secretParameters).toEqual({
        api_token: "ciphertext-of-tok-live-1",
      });
    });

    it("emits the intent without any when the queued event records none", () => {
      const payload = executeIntentFor({
        metadata: { langwatch: { targetReferenceId: "agent_1" } },
      });

      expect(payload).not.toHaveProperty("secretParameters");
    });
  });

  describe("when the queued event declares a secret it carries no value for", () => {
    function evolveQueued(data: Record<string, unknown>) {
      return evolveEvent(
        initialState,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: queuedData(data),
        }),
      );
    }

    /** @scenario "A secret parameter value must be supplied when the run starts" */
    it.each([
      ["no ciphertext at all", undefined],
      ["ciphertext for another name", { other_token: "cipher" }],
      ["an empty ciphertext", { api_token: "" }],
    ])("finishes the run ERROR with %s", (_case, secretParameters) => {
      const evolution = evolveQueued({
        metadata: { secretParameterNames: ["api_token"] },
        ...(secretParameters ? { secretParameters } : {}),
      });

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.intents).toHaveLength(1);
      expect(evolution.intents[0]?.intentType).toBe("finish");
      expect(evolution.intents[0]?.payload).toMatchObject({
        status: ScenarioRunStatus.ERROR,
      });
      expect((evolution.intents[0]?.payload as { error: string }).error).toContain(
        "api_token",
      );
    });

    it("submits the run when the ciphertext covers every declared name", () => {
      const evolution = evolveQueued({
        metadata: { secretParameterNames: ["api_token"] },
        secretParameters: { api_token: "ciphertext-of-tok-live-1" },
      });

      expect(evolution.state.phase).toBe("queued");
      expect(evolution.intents[0]?.intentType).toBe("execute");
    });
  });

  describe("when activity arrives for a live run", () => {
    const activityTypes = [
      SIMULATION_RUN_EVENT_TYPES.STARTED,
      SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
      SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START,
      SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
    ] as const;

    for (const type of activityTypes) {
      it(`moves the run to running and re-arms the stall wake on ${type}`, () => {
        const evolution = evolveEvent(
          queuedState(),
          makeEvent({
            type,
            occurredAt: 20_000,
            data: { scenarioRunId: RUN_ID },
          }),
        );

        expect(evolution.state.phase).toBe("running");
        expect(evolution.state.lastActivityAtMs).toBe(20_000);
        expect(evolution.nextWakeAt).toBe(20_000 + STALL_THRESHOLD_MS);
        expect(evolution.intents).toEqual([]);
      });
    }

    it("stamps activity from the present when the event arrives late", () => {
      const occurredAt = 20_000;
      const now = occurredAt + 30 * 60_000;

      const evolution = evolveEvent(
        runningState(),
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
          occurredAt,
          data: { scenarioRunId: RUN_ID, messages: [] },
        }),
        now,
      );

      expect(evolution.state.lastActivityAtMs).toBe(now);
      expect(evolution.nextWakeAt).toBe(now + STALL_THRESHOLD_MS);
    });
  });

  describe("when cancellation is requested", () => {
    /** @scenario "Cancelling a queued run writes both cancel and finished events" */
    it("finishes a queued run CANCELLED and still broadcasts so the pool drops it", () => {
      const evolution = evolveEvent(
        queuedState(),
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED,
          occurredAt: 15_000,
          data: { scenarioRunId: RUN_ID },
        }),
      );

      // No child to kill, so the run goes terminal without waiting out the
      // grace window. The broadcast is not optional: the execute intent went
      // out when the run was queued, so the pool may already hold this job
      // buffered behind a busy slot, and `pool.wasCancelled` — set only by
      // the cancellation subscriber — is what stops it spawning.
      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.state.cancelRequestedAtMs).toBe(15_000);
      expect(evolution.nextWakeAt).toBeNull();
      expect(evolution.intents).toEqual([
        {
          messageKey: intentKey(`cancel:${RUN_ID}`),
          intentType: "cancel",
          payload: {
            scenarioRunId: RUN_ID,
            projectId: PROJECT_ID,
          },
        },
        {
          messageKey: intentKey(`finish:${RUN_ID}:cancelled`),
          intentType: "finish",
          payload: {
            scenarioRunId: RUN_ID,
            projectId: PROJECT_ID,
            status: ScenarioRunStatus.CANCELLED,
          },
        },
      ]);
    });

    it("broadcasts the cancel for a running run and arms the grace wake", () => {
      const evolution = evolveEvent(
        runningState(),
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED,
          occurredAt: 15_000,
          data: { scenarioRunId: RUN_ID },
        }),
      );

      expect(evolution.state.phase).toBe("cancelling");
      expect(evolution.state.cancelRequestedAtMs).toBe(15_000);
      expect(evolution.nextWakeAt).toBe(15_000 + CANCEL_GRACE_MS);
      expect(evolution.intents).toEqual([
        {
          messageKey: intentKey(`cancel:${RUN_ID}`),
          intentType: "cancel",
          payload: { scenarioRunId: RUN_ID, projectId: PROJECT_ID },
        },
      ]);
    });

    it("is a no-op while already cancelling and keeps the grace wake", () => {
      const state = queuedState({
        phase: "cancelling",
        cancelRequestedAtMs: 15_000,
      });

      const evolution = evolveEvent(
        state,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED,
          occurredAt: 16_000,
          data: { scenarioRunId: RUN_ID },
        }),
      );

      expect(evolution.state).toEqual(state);
      expect(evolution.intents).toEqual([]);
      expect(evolution.nextWakeAt).toBe(15_000 + CANCEL_GRACE_MS);
    });
  });

  describe("when the wake fires", () => {
    /** @scenario "Cancel-grace watchdog force-finishes when the broadcast is lost" */
    it("force-finishes a cancelling run CANCELLED once the grace window passed", () => {
      const state = queuedState({
        phase: "cancelling",
        cancelRequestedAtMs: 15_000,
      });
      const now = 15_000 + CANCEL_GRACE_MS;

      const evolution = evolveWake(state, now, now);

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
      expect(evolution.intents).toHaveLength(1);
      expect(evolution.intents[0]).toMatchObject({
        intentType: "finish",
        payload: {
          scenarioRunId: RUN_ID,
          projectId: PROJECT_ID,
          status: ScenarioRunStatus.CANCELLED,
        },
      });
    });

    it("mints the same finish messageKey as the cancel-requested path (outbox dedup contract)", () => {
      const cancelWhileQueued = evolveEvent(
        queuedState(),
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED,
          occurredAt: 15_000,
          data: { scenarioRunId: RUN_ID },
        }),
      );
      const graceWake = evolveWake(
        queuedState({ phase: "cancelling", cancelRequestedAtMs: 15_000 }),
        15_000 + CANCEL_GRACE_MS,
      );

      // If both paths fire (the broadcast raced the wake), the outbox must
      // collapse them into ONE finished event. Select by intent type rather
      // than position — the queued path also emits the cancel broadcast.
      const finishKey = (intents: typeof graceWake.intents) =>
        intents.find((intent) => intent.intentType === "finish")!.messageKey;

      expect(finishKey(graceWake.intents)).toBe(finishKey(cancelWhileQueued.intents));
    });

    it("keeps the grace wake armed while the cancel is still young", () => {
      const state = queuedState({
        phase: "cancelling",
        cancelRequestedAtMs: 15_000,
      });
      const now = 15_000 + CANCEL_GRACE_MS - 1;

      const evolution = evolveWake(state, now, now);

      expect(evolution.state).toEqual(state);
      expect(evolution.intents).toEqual([]);
      expect(evolution.nextWakeAt).toBe(15_000 + CANCEL_GRACE_MS);
    });

    /** @scenario "Run quiet past the stall threshold finishes ERROR" */
    it.each(["queued", "running"] as const)(
      "finishes a %s run ERROR/stalled once the stall threshold passed",
      (phase) => {
        const state = queuedState({ phase, lastActivityAtMs: 10_000 });
        const now = 10_000 + STALL_THRESHOLD_MS;

        const evolution = evolveWake(state, now, now);

        expect(evolution.state.phase).toBe("terminal");
        expect(evolution.nextWakeAt).toBeNull();
        expect(evolution.intents).toEqual([
          {
            messageKey: intentKey(`finish:${RUN_ID}:stalled`),
            intentType: "finish",
            payload: {
              scenarioRunId: RUN_ID,
              projectId: PROJECT_ID,
              status: ScenarioRunStatus.ERROR,
              error: "stalled",
            },
          },
        ]);
      },
    );

    it.each(["queued", "running"] as const)(
      "re-arms the wake untouched while a %s run is still active",
      (phase) => {
        const state = queuedState({ phase, lastActivityAtMs: 10_000 });
        const now = 10_000 + STALL_THRESHOLD_MS - 1;

        const evolution = evolveWake(state, now, now);

        expect(evolution.state).toEqual(state);
        expect(evolution.intents).toEqual([]);
        expect(evolution.nextWakeAt).toBe(10_000 + STALL_THRESHOLD_MS);
      },
    );

    /** @scenario "A queued run whose execute intent never lands is finished as stalled" */
    it("finishes a run that never left queued, so a lost execute cannot pin it", () => {
      // The old failure: the execute dispatch was fire-and-forget, so a run
      // the pool never accepted sat QUEUED with no terminal event and nothing
      // to close it. The wake is what makes that unreachable now — no
      // activity ever arrives, so the stall deadline is the backstop.
      const neverStarted = queuedState({
        phase: "queued",
        lastActivityAtMs: 10_000,
      });
      const now = 10_000 + STALL_THRESHOLD_MS;

      const evolution = evolveWake(neverStarted, now, now);

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
      expect(evolution.intents).toEqual([
        {
          messageKey: intentKey(`finish:${RUN_ID}:stalled`),
          intentType: "finish",
          payload: {
            scenarioRunId: RUN_ID,
            projectId: PROJECT_ID,
            status: ScenarioRunStatus.ERROR,
            error: "stalled",
          },
        },
      ]);
    });

    it("clears itself for a process that never initialized", () => {
      const evolution = evolveWake(initialState, 5_000);

      expect(evolution.state).toEqual(initialState);
      expect(evolution.intents).toEqual([]);
      expect(evolution.nextWakeAt).toBeNull();
    });

    it("clears itself for a terminal run", () => {
      const evolution = evolveWake(queuedState({ phase: "terminal" }), 5_000);

      expect(evolution.intents).toEqual([]);
      expect(evolution.nextWakeAt).toBeNull();
    });
  });

  describe("when the run reaches a recorded terminal state", () => {
    it.each([
      SIMULATION_RUN_EVENT_TYPES.FINISHED,
      SIMULATION_RUN_EVENT_TYPES.DELETED,
    ] as const)("goes terminal and clears the wake on %s", (type) => {
      const evolution = evolveEvent(
        runningState(),
        makeEvent({
          type,
          occurredAt: 30_000,
          data: { scenarioRunId: RUN_ID },
        }),
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
      expect(evolution.intents).toEqual([]);
    });
  });

  describe("when activity arrives for a cancelling or terminal run", () => {
    it("does not reset anything while cancelling, but keeps the grace wake", () => {
      const state = queuedState({
        phase: "cancelling",
        cancelRequestedAtMs: 15_000,
      });

      const evolution = evolveEvent(
        state,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
          occurredAt: 20_000,
          data: { scenarioRunId: RUN_ID, messages: [] },
        }),
      );

      expect(evolution.state).toEqual(state);
      expect(evolution.intents).toEqual([]);
      // An omitted nextWakeAt would CLEAR the grace wake — the backstop for
      // a lost cancel broadcast.
      expect(evolution.nextWakeAt).toBe(15_000 + CANCEL_GRACE_MS);
    });

    it("ignores activity for a terminal run entirely", () => {
      const state = queuedState({ phase: "terminal" });

      const evolution = evolveEvent(
        state,
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
          occurredAt: 20_000,
          data: { scenarioRunId: RUN_ID, messages: [] },
        }),
      );

      expect(evolution.state).toEqual(state);
      expect(evolution.intents).toEqual([]);
      expect(evolution.nextWakeAt).toBeNull();
    });
  });

  describe("when a queued event carries a malformed target", () => {
    it("normalises it to null rather than letting it reach the schema", () => {
      // The view is persisted and parsed back on the way in, so an object that
      // merely looks like a target would throw there — and a throwing handler
      // redelivers forever. Null is the shape handleRunQueued already answers,
      // by finishing the run as unexecutable.
      const view = buildSimulationRunEventView({
        type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
        occurredAt: 1_000,
        data: {
          scenarioRunId: "run-1",
          scenarioId: "scen-1",
          batchRunId: "batch-1",
          scenarioSetId: "set-1",
          target: { type: "not-a-real-type", referenceId: 42 },
        },
      } as unknown as Parameters<typeof buildSimulationRunEventView>[0]);

      expect(view.target).toBeNull();
      expect(() => simulationRunProcessEventViewSchema.parse(view)).not.toThrow();
    });

    it("keeps a well-formed target", () => {
      const view = buildSimulationRunEventView({
        type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
        occurredAt: 1_000,
        data: {
          scenarioRunId: "run-1",
          target: { type: "prompt", referenceId: "prompt-1" },
        },
      } as unknown as Parameters<typeof buildSimulationRunEventView>[0]);

      expect(view.target).toEqual({ type: "prompt", referenceId: "prompt-1" });
    });
  });

  describe("when an inbox row predates the parameters field", () => {
    it("still parses, reading the missing field as null", () => {
      // Inbox payloads are persisted views: rows written before `parameters`
      // existed have no such key, and handleRunQueued re-parses them on
      // delivery. A required key here would turn every pre-upgrade row into a
      // forever-redelivering handler.
      const { parameters: _dropped, ...legacyRow } = buildSimulationRunEventView(
        makeEvent({
          type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
          occurredAt: 10_000,
          data: queuedData(),
        }),
      );

      const parsed = simulationRunProcessEventViewSchema.parse(legacyRow);

      expect(parsed.parameters).toBeNull();
    });
  });

  describe("when an event carries conversation content", () => {
    // Unique marker strings: if any of these survives into the view, the
    // process state, or an intent payload, conversation content crossed the
    // boundary and is about to be persisted into inbox/outbox rows.
    const MARKERS = [
      "MARKER-message-content",
      "MARKER-verdict-reasoning",
      "MARKER-criterion-text",
      "MARKER-run-metadata",
    ];

    const queuedWithContent = makeEvent({
      type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
      occurredAt: 10_000,
      data: queuedData({
        description: "MARKER-run-metadata",
        metadata: { tenantNote: "MARKER-run-metadata" },
      }),
    });

    const snapshotWithContent = makeEvent({
      type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
      occurredAt: 20_000,
      data: {
        scenarioRunId: RUN_ID,
        messages: [
          { role: "user", content: "MARKER-message-content" },
          { role: "assistant", content: "MARKER-message-content" },
        ],
      },
    });

    const finishedWithContent = makeEvent({
      type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
      occurredAt: 30_000,
      data: {
        scenarioRunId: RUN_ID,
        status: "SUCCESS",
        results: {
          verdict: "success",
          reasoning: "MARKER-verdict-reasoning",
          metCriteria: ["MARKER-criterion-text"],
          unmetCriteria: [],
        },
        durationMs: 1_500,
      },
    });

    const BANNED_KEYS = [
      "messages",
      "content",
      "reasoning",
      "metCriteria",
      "unmetCriteria",
      "metadata",
      "description",
      "results",
    ];

    /**
     * Returns every content leak found in a value: marker substrings in its
     * JSON form, or banned content-bearing keys anywhere in its shape. The
     * assertion stays in the test (`expect(...).toEqual([])`).
     */
    function contentLeaks(value: unknown): string[] {
      const serialized = JSON.stringify(value);
      const keys = collectKeys(value);
      return [
        ...MARKERS.filter((marker) => serialized.includes(marker)).map(
          (marker) => `leaked marker: ${marker}`,
        ),
        ...BANNED_KEYS.filter((key) => keys.has(key)).map((key) => `leaked key: ${key}`),
      ];
    }

    it("strips content from the event view the process persists", () => {
      const views: SimulationRunProcessEventView[] = [
        queuedWithContent,
        snapshotWithContent,
        finishedWithContent,
      ].map((event) => buildSimulationRunEventView(event));

      expect(views.flatMap((view) => contentLeaks(view))).toEqual([]);
      expect(views[1]).toEqual({
        eventType: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
        occurredAt: 20_000,
        status: null,
        scenarioId: null,
        batchRunId: null,
        scenarioSetId: null,
        name: null,
        target: null,
        parameters: null,
        secretParameters: null,
        secretParameterNames: null,
      });
    });

    it("keeps process state and emitted intents free of content across a full run lifecycle", () => {
      const queued = evolveEvent(initialState, queuedWithContent);
      const activity = evolveEvent(queued.state, snapshotWithContent);
      const finished = evolveEvent(activity.state, finishedWithContent);

      const persisted = [queued, activity, finished].flatMap((evolution) => [
        evolution.state,
        evolution.intents,
      ]);

      expect(persisted.flatMap((value) => contentLeaks(value))).toEqual([]);
    });
  });
});
