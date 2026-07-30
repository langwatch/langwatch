import type {
  BuiltProcessManager,
  ProcessContext,
  ReplaceStore,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";

import { createIngestionPullProcessingPipeline } from "../..";
import type { IngestionPullRunStatusData } from "../../projections/ingestionPullRunStatus.projection";
import {
  INGESTION_PULL_PROCESS_NAME,
  type IngestionPullProcessState,
  ingestionPullProcessStateSchema,
} from "../ingestionPullProcess.types";

/**
 * The EXACT manager the runtime mounts — built through `definePipeline`, so
 * these tests cover the generated evolve (wire dispatch, intent-type
 * qualification, wake clearing) rather than a re-implementation. The run port
 * and the outcome commands are never reached: evolve dispatches nothing.
 */
const unreachable = () => Promise.reject(new Error("unused in evolve tests"));

const pipeline = createIngestionPullProcessingPipeline({
  runStatusStore: {
    kind: "replace",
    read: async () => ({ kind: "absent" }),
    write: async () => undefined,
  } satisfies ReplaceStore<IngestionPullRunStatusData>,
  runPort: { run: unreachable },
  commands: {
    recordRunCompleted: unreachable,
    recordRunFailed: unreachable,
  },
});

const manager: BuiltProcessManager =
  pipeline.processManagers[INGESTION_PULL_PROCESS_NAME]!;

const context = (now: number): ProcessContext => ({
  now,
  tenantId: "gov-project",
  processKey: "source-1",
});

function evolve(args: {
  state: IngestionPullProcessState;
  type: string;
  data: unknown;
  now: number;
}) {
  const step = manager.evolve(
    args.state,
    { type: args.type, data: args.data },
    context(args.now),
  );
  if (step === null) throw new Error(`no handler for "${args.type}"`);
  return { ...step, state: ingestionPullProcessStateSchema.parse(step.state) };
}

function wake(state: IngestionPullProcessState, now: number) {
  const step = manager.onWake?.(state, context(now));
  if (!step) throw new Error("the ingestionPull manager declares no onWake");
  return { ...step, state: ingestionPullProcessStateSchema.parse(step.state) };
}

const configuredData = (occurredAt: number) => ({
  sourceId: "source-1",
  cron: "*/15 * * * *",
  configVersion: "v1",
  cursor: "cursor-1",
  occurredAt,
});

function boot(at: number) {
  return evolve({
    state: ingestionPullProcessStateSchema.parse(manager.init()),
    type: "lw.obs.ingestion_pull.configured",
    data: configuredData(at),
    now: at,
  });
}

describe("ingestionPull process manager", () => {
  describe("when a committed configuration carries an invalid cron", () => {
    it("stands the process down instead of poisoning it", () => {
      const previous = boot(Date.parse("2026-07-17T10:00:00Z")).state;
      const at = Date.parse("2026-07-17T10:05:00Z");
      const result = evolve({
        state: previous,
        type: "lw.obs.ingestion_pull.configured",
        data: { ...configuredData(at), cron: "not a cron" },
        now: at,
      });
      expect(result.state).toEqual(previous);
      expect(result.nextWakeAt).toBeNull();
      expect(result.intents).toEqual([]);
    });

    it("stands the process down when the committed configuration has no cron at all", () => {
      const previous = boot(Date.parse("2026-07-17T10:00:00Z")).state;
      const at = Date.parse("2026-07-17T10:05:00Z");
      const result = evolve({
        state: previous,
        type: "lw.obs.ingestion_pull.configured",
        data: {
          sourceId: "source-1",
          configVersion: "v2",
          cursor: null,
          occurredAt: at,
        },
        now: at,
      });
      expect(result.state).toEqual(previous);
      expect(result.nextWakeAt).toBeNull();
      expect(result.intents).toEqual([]);
    });
  });

  it("persists configuration and schedules the first cron wake", () => {
    const result = boot(Date.parse("2026-07-17T10:07:00Z"));
    expect(result.state).toMatchObject({
      sourceId: "source-1",
      enabled: true,
      cron: "*/15 * * * *",
      cursor: "cursor-1",
    });
    expect(result.nextWakeAt).toBe(Date.parse("2026-07-17T10:15:00Z"));
  });

  describe("when a deadline fires long after it was armed", () => {
    it("runs one slot and schedules strictly after the handling time", () => {
      const state = boot(Date.parse("2026-07-17T10:00:00Z")).state;
      const now = Date.parse("2026-07-17T13:02:00Z");
      const result = wake(state, now);

      expect(result.intents).toEqual([
        {
          type: `${INGESTION_PULL_PROCESS_NAME}/run`,
          payload: {
            sourceId: "source-1",
            runId: String(now),
            scheduledFor: now,
            cursor: "cursor-1",
          },
        },
      ]);
      expect(result.state.currentRun).toEqual({
        runId: String(now),
        scheduledFor: now,
        startedAt: now,
      });
      expect(result.nextWakeAt).toBe(Date.parse("2026-07-17T13:15:00Z"));
    });
  });

  it("does not overlap a healthy in-flight run", () => {
    const state: IngestionPullProcessState = {
      ...boot(Date.parse("2026-07-17T10:00:00Z")).state,
      currentRun: { runId: "run", scheduledFor: 1, startedAt: 1_000 },
    };
    const result = wake(state, 2_000);
    expect(result.intents).toEqual([]);
    expect(result.state.currentRun).toEqual(state.currentRun);
  });

  it("advances the durable cursor only from a completion event", () => {
    const state: IngestionPullProcessState = {
      ...boot(Date.parse("2026-07-17T10:00:00Z")).state,
      currentRun: { runId: "run-1", scheduledFor: 1, startedAt: 1 },
    };
    const at = Date.parse("2026-07-17T10:01:00Z");
    const result = evolve({
      state,
      type: "lw.obs.ingestion_pull.run_completed",
      data: {
        sourceId: "source-1",
        runId: "run-1",
        scheduledFor: 1,
        nextCursor: "cursor-2",
        eventCount: 3,
        occurredAt: at,
      },
      now: at,
    });
    expect(result.state.cursor).toBe("cursor-2");
    expect(result.state.currentRun).toBeNull();
  });

  describe("when a completion from a superseded run arrives late", () => {
    it("keeps the live cursor instead of regressing it", () => {
      const state: IngestionPullProcessState = {
        ...boot(Date.parse("2026-07-17T10:00:00Z")).state,
        cursor: "cursor-live",
        currentRun: {
          runId: "run-2",
          scheduledFor: Date.parse("2026-07-17T10:30:00Z"),
          startedAt: Date.parse("2026-07-17T10:30:00Z"),
        },
      };
      const lateAt = Date.parse("2026-07-17T10:31:00Z");
      const result = evolve({
        state,
        type: "lw.obs.ingestion_pull.run_completed",
        data: {
          sourceId: "source-1",
          runId: "run-1",
          scheduledFor: Date.parse("2026-07-17T10:00:00Z"),
          nextCursor: "cursor-stale",
          eventCount: 1,
          occurredAt: lateAt,
        },
        now: lateAt,
      });
      expect(result.state.cursor).toBe("cursor-live");
      expect(result.state.currentRun).toEqual(state.currentRun);
    });
  });

  describe("when an event is handled long after it occurred", () => {
    it("schedules the next wake from the handling time, not the stale event time", () => {
      const state: IngestionPullProcessState = {
        ...boot(Date.parse("2026-07-17T10:00:00Z")).state,
        currentRun: {
          runId: "run-1",
          scheduledFor: Date.parse("2026-07-17T10:00:00Z"),
          startedAt: Date.parse("2026-07-17T10:00:00Z"),
        },
      };
      const result = evolve({
        state,
        type: "lw.obs.ingestion_pull.run_completed",
        data: {
          sourceId: "source-1",
          runId: "run-1",
          scheduledFor: Date.parse("2026-07-17T10:00:00Z"),
          nextCursor: "cursor-2",
          eventCount: 3,
          occurredAt: Date.parse("2026-07-17T10:01:00Z"),
        },
        now: Date.parse("2026-07-17T13:02:00Z"),
      });
      expect(result.nextWakeAt).toBe(Date.parse("2026-07-17T13:15:00Z"));
    });
  });

  it("clears its wake when disabled and late outcomes cannot re-enable it", () => {
    const enabled = boot(Date.parse("2026-07-17T10:00:00Z")).state;
    const disabledAt = Date.parse("2026-07-17T10:01:00Z");
    const disabled = evolve({
      state: enabled,
      type: "lw.obs.ingestion_pull.disabled",
      data: {
        sourceId: "source-1",
        configVersion: "v2",
        occurredAt: disabledAt,
      },
      now: disabledAt,
    });
    const lateAt = Date.parse("2026-07-17T10:02:00Z");
    const lateCompletion = evolve({
      state: disabled.state,
      type: "lw.obs.ingestion_pull.run_completed",
      data: {
        sourceId: "source-1",
        runId: "late-run",
        scheduledFor: lateAt,
        nextCursor: "late-cursor",
        eventCount: 1,
        occurredAt: lateAt,
      },
      now: lateAt,
    });
    expect(lateCompletion.nextWakeAt).toBeNull();
    expect(lateCompletion.state.enabled).toBe(false);
    expect(wake(lateCompletion.state, lateAt).intents).toEqual([]);
  });

  describe("when an event nobody declared a handler for arrives", () => {
    it("runs no step at all", () => {
      expect(
        manager.evolve(
          boot(1_000).state,
          { type: "lw.obs.ingestion_pull.never_declared", data: {} },
          context(1_000),
        ),
      ).toBeNull();
    });
  });
});

describe("the ingestionPull manager's declaration", () => {
  it("subscribes to exactly the four pull events", () => {
    expect([...manager.eventTypes].sort()).toEqual([
      "lw.obs.ingestion_pull.configured",
      "lw.obs.ingestion_pull.disabled",
      "lw.obs.ingestion_pull.run_completed",
      "lw.obs.ingestion_pull.run_failed",
    ]);
  });

  it("qualifies its intent type by its own name, since the outbox is shared", () => {
    expect(manager.intentTypes).toEqual([`${INGESTION_PULL_PROCESS_NAME}/run`]);
  });
});
