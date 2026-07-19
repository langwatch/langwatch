import { describe, expect, it } from "vitest";
import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type {
  ProcessEventEnvelope,
  ProcessInput,
} from "~/server/event-sourcing/process-manager";
import {
  type IngestionPullProcessState,
  ingestionPullProcessDefinition,
} from "..";

const ref = {
  processName: "ingestionPull",
  projectId: "gov-project",
  processKey: "source-1",
};

const configured = (occurredAt: number): ProcessEventEnvelope => ({
  eventId: `event-${occurredAt}`,
  eventType: INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  occurredAt,
  tenantId: "gov-project",
  projectId: "gov-project",
  processKey: "source-1",
  payload: {
    sourceId: "source-1",
    cron: "*/15 * * * *",
    cursor: "cursor-1",
    runId: null,
  },
});

function evolve(previousState: IngestionPullProcessState, input: ProcessInput) {
  return ingestionPullProcessDefinition.evolve({ previousState, input, ref });
}

function boot(at: number) {
  return evolve(ingestionPullProcessDefinition.initialState, {
    kind: "event",
    event: configured(at),
    now: at,
  });
}

describe("ingestionPullProcessDefinition", () => {
  describe("when a committed configuration carries an invalid cron", () => {
    it("disables the process instead of poisoning the subscriber", () => {
      const at = Date.parse("2026-07-17T10:00:00Z");
      const previousState = boot(at).state;
      const result = evolve(previousState, {
        kind: "event",
        event: {
          ...configured(Date.parse("2026-07-17T10:05:00Z")),
          payload: {
            sourceId: "source-1",
            cron: "not a cron",
            cursor: null,
            runId: null,
          },
        },
        now: Date.parse("2026-07-17T10:05:00Z"),
      });
      expect(result.state).toEqual(previousState);
      expect(result.nextWakeAt).toBeNull();
      expect(result.intents).toEqual([]);
    });

    it("disables the process when the committed configuration has no cron at all", () => {
      const at = Date.parse("2026-07-17T10:00:00Z");
      const previousState = boot(at).state;
      const result = evolve(previousState, {
        kind: "event",
        event: {
          ...configured(Date.parse("2026-07-17T10:05:00Z")),
          payload: {
            sourceId: "source-1",
            cron: null,
            cursor: null,
            runId: null,
          },
        },
        now: Date.parse("2026-07-17T10:05:00Z"),
      });
      expect(result.state).toEqual(previousState);
      expect(result.nextWakeAt).toBeNull();
      expect(result.intents).toEqual([]);
    });
  });

  it("persists configuration and schedules the first cron wake", () => {
    const at = Date.parse("2026-07-17T10:07:00Z");
    const result = boot(at);
    expect(result.state).toMatchObject({
      sourceId: "source-1",
      enabled: true,
      cron: "*/15 * * * *",
      cursor: "cursor-1",
    });
    expect(result.nextWakeAt).toBe(Date.parse("2026-07-17T10:15:00Z"));
  });

  it("runs one catch-up slot and schedules strictly after the handling time", () => {
    const state = boot(Date.parse("2026-07-17T10:00:00Z")).state;
    const result = evolve(state, {
      kind: "wake",
      scheduledFor: Date.parse("2026-07-17T10:15:00Z"),
      now: Date.parse("2026-07-17T13:02:00Z"),
    });
    expect(result.intents).toEqual([
      expect.objectContaining({
        messageKey: `pull:source-1:${Date.parse("2026-07-17T10:15:00Z")}`,
        payload: expect.objectContaining({ cursor: "cursor-1" }),
      }),
    ]);
    expect(result.nextWakeAt).toBe(Date.parse("2026-07-17T13:15:00Z"));
  });

  it("does not overlap a healthy in-flight run", () => {
    const state: IngestionPullProcessState = {
      ...boot(Date.parse("2026-07-17T10:00:00Z")).state,
      currentRun: { runId: "run", scheduledFor: 1, startedAt: 1_000 },
    };
    const result = evolve(state, {
      kind: "wake",
      scheduledFor: 2_000,
      now: 2_000,
    });
    expect(result.intents).toEqual([]);
    expect(result.state.currentRun).toEqual(state.currentRun);
  });

  it("advances the durable cursor only from a completion event", () => {
    const state: IngestionPullProcessState = {
      ...boot(Date.parse("2026-07-17T10:00:00Z")).state,
      currentRun: { runId: "run-1", scheduledFor: 1, startedAt: 1 },
    };
    const at = Date.parse("2026-07-17T10:01:00Z");
    const result = evolve(state, {
      kind: "event",
      event: {
        ...configured(at),
        eventType: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
        payload: {
          sourceId: "source-1",
          cron: null,
          cursor: "cursor-2",
          runId: "run-1",
        },
      },
      now: at,
    });
    expect(result.state.cursor).toBe("cursor-2");
    expect(result.state.currentRun).toBeNull();
  });

  describe("when a completion from a superseded run arrives late", () => {
    it("keeps the live cursor instead of regressing it", () => {
      const bootAt = Date.parse("2026-07-17T10:00:00Z");
      const state: IngestionPullProcessState = {
        ...boot(bootAt).state,
        cursor: "cursor-live",
        currentRun: {
          runId: "run-2",
          scheduledFor: Date.parse("2026-07-17T10:30:00Z"),
          startedAt: Date.parse("2026-07-17T10:30:00Z"),
        },
      };
      const lateAt = Date.parse("2026-07-17T10:31:00Z");
      const result = evolve(state, {
        kind: "event",
        event: {
          ...configured(lateAt),
          eventType: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
          payload: {
            sourceId: "source-1",
            cron: null,
            cursor: "cursor-stale",
            runId: "run-1",
          },
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
      const occurredAt = Date.parse("2026-07-17T10:01:00Z");
      const now = Date.parse("2026-07-17T13:02:00Z");
      const result = evolve(state, {
        kind: "event",
        event: {
          ...configured(occurredAt),
          eventType: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
          payload: {
            sourceId: "source-1",
            cron: null,
            cursor: "cursor-2",
            runId: "run-1",
          },
        },
        now,
      });
      expect(result.nextWakeAt).toBe(Date.parse("2026-07-17T13:15:00Z"));
    });
  });

  it("clears its wake when disabled and late outcomes cannot re-enable it", () => {
    const enabled = boot(Date.parse("2026-07-17T10:00:00Z")).state;
    const disabledAt = Date.parse("2026-07-17T10:01:00Z");
    const disabled = evolve(enabled, {
      kind: "event",
      event: {
        ...configured(disabledAt),
        eventType: INGESTION_PULL_EVENT_TYPES.DISABLED,
      },
      now: disabledAt,
    });
    const lateAt = Date.parse("2026-07-17T10:02:00Z");
    const lateCompletion = evolve(disabled.state, {
      kind: "event",
      event: {
        ...configured(lateAt),
        eventType: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
        payload: {
          sourceId: "source-1",
          cron: null,
          cursor: "late-cursor",
          runId: "late-run",
        },
      },
      now: lateAt,
    });
    expect(lateCompletion.nextWakeAt).toBeNull();
    expect(lateCompletion.state.enabled).toBe(false);
  });
});
