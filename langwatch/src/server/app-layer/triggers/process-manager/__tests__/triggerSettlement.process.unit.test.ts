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
  overflowDropped: 0,
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
        const second = addPending(first, match(), 10_000);

        expect(settleBoundary(second)).toBe(40_000);
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
            },
            "trace-a": {
              settleDueAt: 800,
              dispatchDueAt: 1_000,
              actionClass: "notify",
            },
          },
          overflowDropped: 0,
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
            },
            "trace-b": {
              settleDueAt: 900,
              dispatchDueAt: 1_000,
              actionClass: "persist",
            },
          },
          overflowDropped: 0,
        };

        expect(drainDue(state, 1_000).settledMatches).toEqual([
          { traceId: "trace-a" },
          { traceId: "trace-b" },
        ]);
      });

      it("keeps the next future boundary durable", () => {
        const state: SettlementState = {
          pendingMatches: {
            due: {
              settleDueAt: 800,
              dispatchDueAt: 1_000,
              actionClass: "notify",
            },
            future: {
              settleDueAt: 1_800,
              dispatchDueAt: 2_000,
              actionClass: "notify",
            },
          },
          overflowDropped: 0,
        };

        expect(drainDue(state, 1_000).nextBoundary).toBe(2_000);
      });
    });
  });

  describe("given more pending matches than the state bound", () => {
    describe("when another match is recorded", () => {
      it("drops the oldest match and records the overflow", () => {
        const pendingMatches = Object.fromEntries(
          Array.from({ length: MAX_PENDING_MATCHES }, (_, index) => [
            `trace-${index}`,
            {
              settleDueAt: index,
              dispatchDueAt: index,
              actionClass: "notify" as const,
            },
          ]),
        );

        const next = addPending(
          { pendingMatches, overflowDropped: 0 },
          match({ traceId: "newest" }),
          MAX_PENDING_MATCHES + 1,
        );

        expect(Object.keys(next.pendingMatches)).toHaveLength(
          MAX_PENDING_MATCHES,
        );
        expect(next.pendingMatches["trace-0"]).toBeUndefined();
        expect(next.overflowDropped).toBe(1);
      });

      it("emits one post-commit log intent with the drop count", () => {
        const pendingMatches = Object.fromEntries(
          Array.from({ length: MAX_PENDING_MATCHES }, (_, index) => [
            `trace-${index}`,
            {
              settleDueAt: index,
              dispatchDueAt: index,
              actionClass: "notify" as const,
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
          { pendingMatches, overflowDropped: 4 },
          match({ traceId: "newest" }),
          {
            at: MAX_PENDING_MATCHES + 1,
            key: "trigger-1",
            projectId: "project-1",
            intents: buildIntentFactories(definition.config.intents),
          },
        );

        expect(evolution.intents).toEqual([
          {
            messageKey: "overflow:5",
            intentType: "logOverflow",
            payload: {
              triggerId: "trigger-1",
              dropped: 1,
              totalDropped: 5,
            },
          },
        ]);
      });
    });
  });
});
