import { TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import { buildIntentFactories } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/automations/schemas/constants";
import type { TriggerMatchRecordedEventData } from "~/server/event-sourcing/pipelines/automations/schemas/events";
import {
  addPending,
  drainDue,
  MAX_PENDING_MATCHES,
  type SettlementState,
  settleBoundary,
  triggerSettlementPM,
} from "../triggerSettlement.process";
import type { TriggerSettlementDispatchDeps } from "../triggerSettlementIntentHandlers";

const initialState = (): SettlementState => ({
  pendingMatches: {},
  overflowFlushed: 0,
});

const match = (
  overrides: Partial<TriggerMatchRecordedEventData> = {},
): TriggerMatchRecordedEventData => ({
  triggerId: "trigger-1",
  traceId: "trace-1",
  action: TriggerAction.SEND_EMAIL,
  actionClass: "notify",
  traceDebounceMs: 30_000,
  notificationCadence: "immediate",
  ...overrides,
});

describe("trigger settlement process", () => {
  describe("given a trace is already pending", () => {
    describe("when the trace matches again", () => {
      it("moves the durable settle wake later", () => {
        const first = addPending(initialState(), match(), 1_000);
        const second = addPending(first.state, match(), 10_000);

        expect(settleBoundary(second.state)).toBe(40_000);
      });
    });
  });

  describe("given notify and persist matches are due", () => {
    describe("when the process wakes", () => {
      it("coalesces notify matches at one cadence boundary", () => {
        const state: SettlementState = {
          pendingMatches: {
            "trace-b": {
              settleDueAt: 900,
              dispatchDueAt: 1_000,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
            "trace-a": {
              settleDueAt: 800,
              dispatchDueAt: 1_000,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
          },
          overflowFlushed: 0,
        };

        expect(drainDue(state, 1_000).boundaries).toEqual([
          { key: 1_000, traceIds: ["trace-a", "trace-b"] },
        ]);
      });

      it("emits persist matches independently", () => {
        const state: SettlementState = {
          pendingMatches: {
            "trace-a": {
              settleDueAt: 800,
              dispatchDueAt: 1_000,
              actionClass: "persist",
              settleWindowBucket: "30000-0",
            },
            "trace-b": {
              settleDueAt: 900,
              dispatchDueAt: 1_000,
              actionClass: "persist",
              settleWindowBucket: "30000-0",
            },
          },
          overflowFlushed: 0,
        };

        expect(drainDue(state, 1_000).settledMatches).toEqual([
          { traceId: "trace-a", settleWindowBucket: "30000-0" },
          { traceId: "trace-b", settleWindowBucket: "30000-0" },
        ]);
      });

      it("keeps the next future boundary durable", () => {
        const state: SettlementState = {
          pendingMatches: {
            due: {
              settleDueAt: 800,
              dispatchDueAt: 1_000,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
            future: {
              settleDueAt: 1_800,
              dispatchDueAt: 2_000,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
          },
          overflowFlushed: 0,
        };

        expect(drainDue(state, 1_000).nextBoundary).toBe(2_000);
      });
    });
  });

  describe("given a persist match completed its settle round", () => {
    describe("when later activity arrives in a new settle window", () => {
      it("creates a fresh persist intent for the later round", () => {
        const definition = buildProcessManager({
          name: "triggerSettlement",
          applier: triggerSettlementPM({
            dispatch: {} as TriggerSettlementDispatchDeps,
          }),
        });
        const evolve =
          definition.config.handlers[TRIGGER_MATCH_RECORDED_EVENT_TYPE]!;
        const intents = buildIntentFactories(definition.config.intents);
        const context = {
          key: "trigger-1",
          projectId: "project-1",
          intents,
        };

        const firstRound = evolve(
          initialState(),
          match({
            action: TriggerAction.ADD_TO_DATASET,
            actionClass: "persist",
          }),
          { ...context, at: 1_000 },
        );
        const firstWake = definition.config.onWake!(firstRound.state, {
          ...context,
          at: 31_000,
        });
        const secondRound = evolve(
          firstWake.state,
          match({
            action: TriggerAction.ADD_TO_DATASET,
            actionClass: "persist",
          }),
          { ...context, at: 31_001 },
        );
        const secondWake = definition.config.onWake!(secondRound.state, {
          ...context,
          at: 61_001,
        });

        expect(firstWake.intents?.map((intent) => intent.messageKey)).toEqual([
          "persist:trace-1:30000-0",
        ]);
        expect(secondWake.intents?.map((intent) => intent.messageKey)).toEqual([
          "persist:trace-1:30000-1",
        ]);
      });
    });
  });

  describe("given more pending matches than the state bound", () => {
    describe("when another match is recorded", () => {
      it("flushes the oldest match out of pending state without discarding it", () => {
        const pendingMatches = Object.fromEntries(
          Array.from({ length: MAX_PENDING_MATCHES }, (_, index) => [
            `trace-${index}`,
            {
              settleDueAt: index,
              dispatchDueAt: index,
              actionClass: "notify" as const,
              settleWindowBucket: "30000-0",
            },
          ]),
        );

        const next = addPending(
          { pendingMatches, overflowFlushed: 0 },
          match({ traceId: "newest" }),
          MAX_PENDING_MATCHES + 1,
        );

        expect(Object.keys(next.state.pendingMatches)).toHaveLength(
          MAX_PENDING_MATCHES,
        );
        expect(next.state.pendingMatches["trace-0"]).toBeUndefined();
        expect(next.state.overflowFlushed).toBe(1);
        expect(next.flushed).toEqual([
          {
            traceId: "trace-0",
            match: {
              settleDueAt: 0,
              dispatchDueAt: 0,
              actionClass: "notify",
              settleWindowBucket: "30000-0",
            },
          },
        ]);
      });

      it("emits immediate dispatch intents for the flushed matches plus one log intent", () => {
        const pendingMatches = Object.fromEntries(
          Array.from({ length: MAX_PENDING_MATCHES }, (_, index) => [
            `trace-${index}`,
            {
              settleDueAt: index,
              dispatchDueAt: index === 0 ? 1_000 : index,
              actionClass: index === 0 ? ("persist" as const) : ("notify" as const),
              settleWindowBucket: "30000-0",
            },
          ]),
        );
        const definition = buildProcessManager({
          name: "triggerSettlement",
          applier: triggerSettlementPM({
            dispatch: {} as TriggerSettlementDispatchDeps,
          }),
        });
        const evolve =
          definition.config.handlers[TRIGGER_MATCH_RECORDED_EVENT_TYPE]!;

        const evolution = evolve(
          { pendingMatches, overflowFlushed: 4 },
          match({ traceId: "newest" }),
          {
            at: MAX_PENDING_MATCHES + 1,
            key: "trigger-1",
            projectId: "project-1",
            intents: buildIntentFactories(definition.config.intents),
          },
        );

        // trace-0 (oldest, persist-class) flushes to an immediate persist
        // intent with its settle-window identity; the log intent records the
        // running flush count. Nothing is discarded.
        expect(evolution.intents).toEqual([
          {
            messageKey: "persist:trace-0:30000-0",
            intentType: "persistMatch",
            payload: {
              triggerId: "trigger-1",
              traceId: "trace-0",
            },
          },
          {
            messageKey: "overflow:5",
            intentType: "logOverflow",
            payload: {
              triggerId: "trigger-1",
              flushed: 1,
              totalFlushed: 5,
            },
          },
        ]);
      });
    });
  });
});
