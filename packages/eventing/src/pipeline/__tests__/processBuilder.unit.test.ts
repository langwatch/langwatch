import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Event } from "../../domain/types";
import type { ProcessManagerInitialStage } from "../processBuilder";
import { buildProcessManager } from "../processBuilder";
import type { IntentSpec, WakeHandler } from "../processManagerDefinition";

const payloadSchema = z.object({ traceId: z.string() });
const TEST_PROCESS_EVENT_TYPE = "test.process.triggered";
type ProcessTestEvent = Event<{ traceId: string }> & {
  type: typeof TEST_PROCESS_EVENT_TYPE;
};

function typeCheckStaging(pm: ProcessManagerInitialStage<ProcessTestEvent>) {
  // @ts-expect-error state must be declared before event handlers
  pm.on(TEST_PROCESS_EVENT_TYPE, () => ({ state: {} }));

  const state = pm.state({ count: 0 });
  // @ts-expect-error intents must be declared before event handlers
  state.on(TEST_PROCESS_EVENT_TYPE, () => ({ state: { count: 1 } }));
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
              .state({ traceIds: [] as string[] })
              .intent("persistMatch", payloadSchema, async () => {})
              .on(TEST_PROCESS_EVENT_TYPE, (state, data, ctx) => ({
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

        expect(definition.config.eventTypes).toEqual([TEST_PROCESS_EVENT_TYPE]);
      });

      it("keeps the declared outbox policy", () => {
        const definition = buildProcessManager<ProcessTestEvent>({
          name: "triggerSettlement",
          applier: (pm) =>
            pm
              .state({ traceIds: [] as string[] })
              .intent("persistMatch", payloadSchema, async () => {})
              .on(TEST_PROCESS_EVENT_TYPE, (state) => ({ state }))
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
              .state({ count: 0 })
              .intent("noop", z.object({}), async () => {})
              .keyBy((event) => event.data.traceId)
              .on(TEST_PROCESS_EVENT_TYPE, (state) => ({ state })),
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
            ctx.intents.evaluateGraph(`sweep:${ctx.at}`, {
              traceId: "sweep",
            }),
          ],
        });

        const definition = buildProcessManager<ProcessTestEvent>({
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
      it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects everyMs=%s", (everyMs) => {
        expect(() =>
          buildProcessManager<ProcessTestEvent>({
            name: "invalidSweep",
            applier: (pm) =>
              pm
                .state({ lastWakeAt: null as number | null })
                .schedule({ everyMs })
                .onWake<{ evaluateGraph: IntentSpec<typeof payloadSchema> }>((state) => ({ state }))
                .intent("evaluateGraph", payloadSchema, async () => {}),
          }),
        ).toThrow(/positive finite number/);
      });
    });
  });

  describe("given a signal-driven process manager", () => {
    it("builds without an event subscription or schedule", () => {
      const definition = buildProcessManager<ProcessTestEvent>({
        name: "signalOnly",
        applier: (pm) =>
          pm
            .state({ count: 0 })
            .intent("recordCount", z.object({ count: z.number() }), async () => {})
            .onSignal("increment", z.object({ by: z.number().int() }), (state, data, ctx) => ({
              state: { count: state.count + data.by },
              intents: [
                ctx.intents.recordCount(`count:${state.count + data.by}`, {
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
              .state({ count: 0 })
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
                .state({ count: 0 })
                .intent("persistMatch", payloadSchema, async () => {})
                .intent("persistMatch", payloadSchema, async () => {})
                .on(TEST_PROCESS_EVENT_TYPE, (state) => ({ state })),
          }),
        ).toThrow(/already declares intent/);
      });
    });
  });
});
