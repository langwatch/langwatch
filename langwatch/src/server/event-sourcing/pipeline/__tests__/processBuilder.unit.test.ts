import { z } from "zod";
import { describe, expect, it } from "vitest";

import type { ProcessManagerInitialStage } from "../processBuilder";
import { buildProcessManager } from "../processBuilder";
import type {
  IntentSpec,
  WakeHandler,
} from "../processManagerDefinition";
import type { AutomationEvent } from "../../pipelines/automations/schemas/events";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "../../pipelines/automations/schemas/constants";

const payloadSchema = z.object({ traceId: z.string() });

function typeCheckStaging(pm: ProcessManagerInitialStage<AutomationEvent>) {
  // @ts-expect-error state must be declared before event handlers
  pm.on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, () => ({ state: {} }));

  const state = pm.state({ count: 0 });
  // @ts-expect-error intents must be declared before event handlers
  state.on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, () => ({ state: { count: 1 } }));
  // @ts-expect-error outbox is unavailable until an intent exists
  state.outbox({ maxAttempts: 8 });
}
void typeCheckStaging;

describe("ProcessManagerBuilder", () => {
  describe("given an event-driven process manager", () => {
    describe("when the approved chain is built", () => {
      it("derives its subscription from on()", () => {
        const definition = buildProcessManager<AutomationEvent>({
          name: "triggerSettlement",
          applier: (pm) =>
            pm
              .state({ traceIds: [] as string[] })
              .intent("persistMatch", payloadSchema, async () => {})
              .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state, data, ctx) => ({
                state: {
                  traceIds: [...state.traceIds, data.traceId],
                },
                intents: [
                  ctx.intents.persistMatch(`persist:${data.traceId}`, {
                    traceId: data.traceId,
                  }),
                ],
              }))
              .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 }),
        });

        expect(definition.config.eventTypes).toEqual([
          TRIGGER_MATCH_RECORDED_EVENT_TYPE,
        ]);
      });

      it("keeps the declared outbox policy", () => {
        const definition = buildProcessManager<AutomationEvent>({
          name: "triggerSettlement",
          applier: (pm) =>
            pm
              .state({ traceIds: [] as string[] })
              .intent("persistMatch", payloadSchema, async () => {})
              .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state) => ({ state }))
              .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 }),
        });

        expect(definition.config.outbox).toEqual({
          maxAttempts: 8,
          leaseDurationMs: 120_000,
        });
      });
    });
  });

  describe("given a scheduled process manager", () => {
    describe("when onWake declares future intent factories", () => {
      it("builds the schedule-onWake-intent chain", () => {
        type SweepIntents = { evaluateGraph: IntentSpec<typeof payloadSchema> };
        const sweep: WakeHandler<{ lastWakeAt: number | null }, SweepIntents> =
          (state, ctx) => ({
            state: { lastWakeAt: ctx.at },
            intents: [
              ctx.intents.evaluateGraph(`sweep:${ctx.at}`, {
                traceId: "sweep",
              }),
            ],
          });

        const definition = buildProcessManager<AutomationEvent>({
          name: "graphAlertSweep",
          applier: (pm) =>
            pm
              .state({ lastWakeAt: null as number | null })
              .schedule({ everyMs: 30_000 })
              .onWake(sweep)
              .intent("evaluateGraph", payloadSchema, async () => {}),
        });

        expect(definition.config.schedule).toEqual({ everyMs: 30_000 });
      });
    });

    describe("when the interval cannot advance time", () => {
      it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
        "rejects everyMs=%s",
        (everyMs) => {
          expect(() =>
            buildProcessManager<AutomationEvent>({
              name: "invalidSweep",
              applier: (pm) =>
                pm
                  .state({ lastWakeAt: null as number | null })
                  .schedule({ everyMs })
                  .onWake<{ evaluateGraph: IntentSpec<typeof payloadSchema> }>(
                    (state) => ({ state }),
                  )
                  .intent("evaluateGraph", payloadSchema, async () => {}),
            }),
          ).toThrow(/positive finite number/);
        },
      );
    });
  });

  describe("given duplicate declarations", () => {
    describe("when the same intent is declared twice", () => {
      it("throws a configuration error", () => {
        expect(() =>
          buildProcessManager<AutomationEvent>({
            name: "duplicateIntent",
            applier: (pm) =>
              pm
                .state({ count: 0 })
                .intent("persistMatch", payloadSchema, async () => {})
                .intent("persistMatch", payloadSchema, async () => {})
                .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state) => ({ state })),
          }),
        ).toThrow(/already declares intent/);
      });
    });
  });
});
