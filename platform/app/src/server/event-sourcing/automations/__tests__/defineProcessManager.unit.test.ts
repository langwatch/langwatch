import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineProcessManager } from "../process-managers/defineProcessManager";

interface CounterState {
  readonly total: number;
}

describe("defineProcessManager", () => {
  describe("given intents are declared as a schema map", () => {
    it("derives the intent-type strings from the map's own keys, with no second declaration", () => {
      const definition = defineProcessManager("counter")
        .state(z.object({ total: z.number() }), (): CounterState => ({ total: 0 }))
        .intents({
          bump: z.object({ by: z.number() }),
          reset: z.object({}),
        })
        .events({
          incremented: (state, data: { by: number }, ctx) => ({
            state: { total: state.total + data.by },
            intents: [ctx.intents.bump(`bump:${ctx.key}`, { by: data.by })],
          }),
        })
        .build();

      const result = definition.evolve("incremented", { total: 0 }, { by: 3 }, {
        key: "counter-1",
        tenantId: "tenant-1",
        at: 1_000,
        now: 1_000,
      });

      expect(result?.state).toEqual({ total: 3 });
      // The messageKey is the caller's; intentType is derived from the
      // `intents` map's own key ("bump") — nowhere hand-typed a second time.
      expect(result?.intents).toEqual([
        { messageKey: "bump:counter-1", intentType: "bump", payload: { by: 3 } },
      ]);
    });
  });

  describe("given an event type the process did not declare", () => {
    it("returns undefined rather than throwing — an unrecognised event is not this process's problem", () => {
      const definition = defineProcessManager("counter")
        .state(z.object({ total: z.number() }), (): CounterState => ({ total: 0 }))
        .intents({ bump: z.object({ by: z.number() }) })
        .events({
          incremented: (state) => ({ state }),
        })
        .build();

      const result = definition.evolve("somethingElse", { total: 0 }, {}, {
        key: "counter-1",
        tenantId: "tenant-1",
        at: 1_000,
        now: 1_000,
      });

      expect(result).toBeUndefined();
    });
  });

  describe("given a schedule-only process with no events", () => {
    it("declares an empty eventTypes list and a wake that receives the same derived intent factories", () => {
      const definition = defineProcessManager("heartbeat")
        .state(z.object({ total: z.number() }), (): CounterState => ({ total: 0 }))
        .intents({ tick: z.object({ at: z.number() }) })
        .schedule({ everyMs: 60_000 })
        .onWake((state, ctx) => ({
          state,
          intents: [ctx.intents.tick(`tick:${ctx.at}`, { at: ctx.at })],
        }));

      expect(definition.eventTypes).toEqual([]);
      expect(definition.schedule).toEqual({ everyMs: 60_000 });

      const woken = definition.onWake!({ total: 0 }, {
        key: "heartbeat",
        tenantId: "__global__",
        at: 5_000,
        now: 5_000,
      });
      expect(woken.intents).toEqual([
        { messageKey: "tick:5000", intentType: "tick", payload: { at: 5_000 } },
      ]);
    });
  });

  describe("given the same definition is asked for its intents twice", () => {
    it("returns the identical typed factories both times — nothing rebuilds them per call", () => {
      const definition = defineProcessManager("counter")
        .state(z.object({ total: z.number() }), (): CounterState => ({ total: 0 }))
        .intents({ bump: z.object({ by: z.number() }) })
        .events({ incremented: (state) => ({ state }) })
        .build();

      expect(definition.intents).toBe(definition.intents);
      expect(Object.keys(definition.intentSchemas)).toEqual(["bump"]);
    });
  });
});
