import { describe, expect, it } from "vitest";
import { z } from "zod";

import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import type { ProcessManagerInitialStage } from "../processBuilder.ts";
import { buildProcessManager } from "../processBuilder.ts";
import type { IntentSpec, WakeHandler } from "../processManagerDefinition.ts";

const payloadSchema = z.object({ traceId: z.string() });
const TEST_PROCESS_EVENT_TYPE = "test.process.triggered";
const testProcessEventSchema = testEventSchema(TEST_PROCESS_EVENT_TYPE, payloadSchema);
type ProcessTestEvent = z.infer<typeof testProcessEventSchema>;

function typeCheckStaging(pm: ProcessManagerInitialStage<ProcessTestEvent>) {
  // @ts-expect-error state must be declared before event handlers
  pm.on(testProcessEventSchema, () => ({ state: {} }));

  const state = pm.state(z.object({ count: z.number() }), { count: 0 });
  // @ts-expect-error intents must be declared before event handlers
  state.on(testProcessEventSchema, () => ({ state: { count: 1 } }));
  // @ts-expect-error intents must be declared before signal handlers
  state.onSignal("increment", z.object({ by: z.number() }), () => ({
    state: { count: 1 },
  }));
  // @ts-expect-error outbox is unavailable until an intent exists
  state.outbox({ maxAttempts: 8 });
}
void typeCheckStaging;

describe("ProcessManagerBuilder", () => {
  describe("given an event-driven process manager", () => {
    describe("when the approved chain is built", () => {
      it("derives its subscription from on()", () => {
        const definition = buildProcessManager<ProcessTestEvent>({
          name: "triggerSettlement",
          applier: (pm) =>
            pm
              .state(z.object({ traceIds: z.array(z.string()) }), { traceIds: [] })
              .intent("persistMatch", payloadSchema, async () => {})
              .on(testProcessEventSchema, (state, data, ctx) => ({
                state: {
                  traceIds: [...state.traceIds, data.traceId],
                },
                intents: [
                  ctx.intent("persistMatch", `persist:${data.traceId}`, {
                    traceId: data.traceId,
                  }),
                ],
              }))
              .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 }),
        });

        expect(definition.config.eventTypes).toEqual([TEST_PROCESS_EVENT_TYPE]);
      });

      it("keeps the declared outbox policy", () => {
        const definition = buildProcessManager<ProcessTestEvent>({
          name: "triggerSettlement",
          applier: (pm) =>
            pm
              .state(z.object({ traceIds: z.array(z.string()) }), { traceIds: [] })
              .intent("persistMatch", payloadSchema, async () => {})
              .on(testProcessEventSchema, (state) => ({ state }))
              .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 }),
        });

        expect(definition.config.outbox).toEqual({
          maxAttempts: 8,
          leaseDurationMs: 120_000,
        });
      });

      it("keeps an explicit per-event process key resolver", () => {
        const definition = buildProcessManager<ProcessTestEvent>({
          name: "operationLifecycle",
          applier: (pm) =>
            pm
              .state(z.object({ count: z.number() }), { count: 0 })
              .intent("noop", z.object({}), async () => {})
              .keyBy((event) => event.data.traceId)
              .on(testProcessEventSchema, (state) => ({ state })),
        });
        const event = {
          type: TEST_PROCESS_EVENT_TYPE,
          data: { traceId: "operation-1" },
        } as ProcessTestEvent;

        expect(definition.config.keyBy?.(event)).toBe("operation-1");
      });
    });
  });

  describe("given a scheduled process manager", () => {
    describe("when onWake declares future intent factories", () => {
      it("builds the schedule-onWake-intent chain", () => {
        type SweepIntents = { evaluateGraph: IntentSpec<typeof payloadSchema> };
        const sweep: WakeHandler<{ lastWakeAt: number | null }, SweepIntents> = (state, ctx) => ({
          state: { lastWakeAt: ctx.at },
          intents: [
            ctx.intent("evaluateGraph", `sweep:${ctx.at}`, {
              traceId: "sweep",
            }),
          ],
        });

        const definition = buildProcessManager<ProcessTestEvent>({
          name: "graphAlertSweep",
          applier: (pm) =>
            pm
              .state(z.object({ lastWakeAt: z.number().nullable() }), { lastWakeAt: null })
              .schedule({ everyMs: 30_000 })
              .onWake(sweep)
              .intent("evaluateGraph", payloadSchema, async () => {}),
        });

        expect(definition.config.schedule).toEqual({ everyMs: 30_000 });
      });
    });

    describe("when the interval cannot advance time", () => {
      it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects everyMs=%s", (everyMs) => {
        expect(() =>
          buildProcessManager<ProcessTestEvent>({
            name: "invalidSweep",
            applier: (pm) =>
              pm
                .state(z.object({ lastWakeAt: z.number().nullable() }), { lastWakeAt: null })
                .schedule({ everyMs })
                .onWake<{ evaluateGraph: IntentSpec<typeof payloadSchema> }>((state) => ({ state }))
                .intent("evaluateGraph", payloadSchema, async () => {}),
          }),
        ).toThrow(/positive finite number/);
      });
    });

    describe("when the schedule is also given a key", () => {
      it("refuses the pair, naming the singleton the schedule is armed on", () => {
        expect(() =>
          buildProcessManager<ProcessTestEvent>({
            name: "keyedSweep",
            applier: (pm) =>
              pm
                .state(z.object({ lastWakeAt: z.number().nullable() }), { lastWakeAt: null })
                .schedule({ everyMs: 30_000 })
                .onWake<{ evaluateGraph: IntentSpec<typeof payloadSchema> }>((state) => ({ state }))
                .intent("evaluateGraph", payloadSchema, async () => {})
                .keyBy((event) => event.data.traceId),
          }),
        ).toThrow(/cannot be keyed and scheduled/);
      });
    });
  });

  describe("given a signal-driven process manager", () => {
    it("builds without an event subscription or schedule", () => {
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "signalOnly",
        applier: (pm) =>
          pm
            .state(z.object({ count: z.number() }), { count: 0 })
            .intent("recordCount", z.object({ count: z.number() }), async () => {})
            .onSignal("increment", z.object({ by: z.number().int() }), (state, data, ctx) => ({
              state: { count: state.count + data.by },
              intents: [
                ctx.intent("recordCount", `count:${state.count + data.by}`, {
                  count: state.count + data.by,
                }),
              ],
            })),
      });

      expect(definition.config.eventTypes).toEqual([]);
      expect(Object.keys(definition.config.signals ?? {})).toEqual(["increment"]);
    });

    it("rejects duplicate signal declarations", () => {
      expect(() =>
        buildProcessManager<ProcessTestEvent>({
          name: "duplicateSignal",
          applier: (pm) =>
            pm
              .state(z.object({ count: z.number() }), { count: 0 })
              .intent("noop", z.object({}), async () => {})
              .onSignal("increment", z.object({ by: z.number() }), (state) => ({
                state,
              }))
              .onSignal("increment", z.object({ by: z.number() }), (state) => ({
                state,
              })),
        }),
      ).toThrow(/already handles signal/);
    });
  });

  describe("given duplicate declarations", () => {
    describe("when the same intent is declared twice", () => {
      it("throws a configuration error", () => {
        expect(() =>
          buildProcessManager<ProcessTestEvent>({
            name: "duplicateIntent",
            applier: (pm) =>
              pm
                .state(z.object({ count: z.number() }), { count: 0 })
                .intent("persistMatch", payloadSchema, async () => {})
                .intent("persistMatch", payloadSchema, async () => {})
                .on(testProcessEventSchema, (state) => ({ state })),
          }),
        ).toThrow(/already declares intent/);
      });
    });
  });
});
