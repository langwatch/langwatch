import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigurationError } from "../errors";
import { defineAggregate } from "./defineAggregate";

/**
 * The point of the declaration is that the derived things cannot disagree with
 * the declared ones, so these tests are about derivation and about the guards
 * that stop a declaration producing something unroutable.
 */

const runState = z.object({
  completed: z.number(),
  status: z.string(),
});
type RunState = z.infer<typeof runState>;

const buildRun = () =>
  defineAggregate("experiment_run")
    .state(runState, () => ({ completed: 0, status: "queued" }))
    .events({
      itemCompleted: {
        data: z.object({ cost: z.number() }),
        apply: (s: RunState) => ({ ...s, completed: s.completed + 1 }),
      },
      finished: {
        data: z.object({ at: z.number() }),
        apply: (s: RunState) => ({ ...s, status: "finished" }),
      },
    });

describe("defineAggregate", () => {
  describe("given events are declared", () => {
    it("derives a type string per event, qualified by the aggregate", () => {
      const run = buildRun().build();
      expect([...run.eventTypes].sort()).toEqual([
        "experiment_run/finished",
        "experiment_run/itemCompleted",
      ]);
    });

    it("creates events whose type matches what the router dispatches on", () => {
      const run = buildRun().build();
      const event = run.events.itemCompleted({ cost: 5 });
      expect(run.eventTypes).toContain(event.type);
    });

    it("applies an event through the handler declared beside its schema", () => {
      const run = buildRun().build();
      const next = run.apply(run.init(), run.events.itemCompleted({ cost: 1 }));
      expect(next.completed).toBe(1);
    });

    it("leaves state untouched for a type it was not built with", () => {
      // An older worker draining the queue after a deploy that added an event
      // must not fail on it. It contributes nothing and carries on.
      const run = buildRun().build();
      const state = run.init();
      expect(run.apply(state, { type: "experiment_run/added_later", data: {} }))
        .toEqual(state);
    });

    it("gives each aggregate its own genesis state", () => {
      const run = buildRun().build();
      const first = run.init();
      first.completed = 99;
      expect(run.init().completed).toBe(0);
    });
  });

  describe("when the state version is derived", () => {
    it("reports a hash for a schema that was not pinned", () => {
      const run = buildRun().build();
      expect(run.stateVersion).toBe(run.schemaHash);
    });

    it("keeps reporting the hash when a version is pinned", () => {
      // A pin decouples the number from the shape; it does not switch off drift
      // detection, so the hash must still be observable.
      const run = buildRun().build({ stateVersion: "7" });
      expect(run.stateVersion).toBe("7");
      expect(run.schemaHash).not.toBe("7");
    });

    it("changes the derived version when the state shape changes", () => {
      const wider = defineAggregate("experiment_run")
        .state(runState.extend({ failed: z.number() }), () => ({
          completed: 0,
          status: "queued",
          failed: 0,
        }))
        .events({
          itemCompleted: {
            data: z.object({ cost: z.number() }),
            apply: (s) => s,
          },
        })
        .build();
      expect(wider.schemaHash).not.toBe(buildRun().build().schemaHash);
    });
  });

  describe("when a declaration would produce an unroutable type string", () => {
    it("refuses an aggregate name containing the separator", () => {
      expect(() => defineAggregate("bad/name")).toThrow(ConfigurationError);
    });

    it("refuses an event key containing the separator", () => {
      expect(() =>
        defineAggregate("run")
          .state(runState, () => ({ completed: 0, status: "" }))
          .events({ "bad/key": { data: z.object({}), apply: (s) => s } }),
      ).toThrow(ConfigurationError);
    });

    it("refuses an aggregate that declares no events", () => {
      expect(() =>
        defineAggregate("run")
          .state(runState, () => ({ completed: 0, status: "" }))
          .events({}),
      ).toThrow(ConfigurationError);
    });
  });

  describe("when commands are declared", () => {
    it("emits events the aggregate can apply", () => {
      const run = buildRun()
        .commands({
          completeItem: {
            input: z.object({ cost: z.number() }),
            handle: (_s, input, events) => [events.itemCompleted(input)],
          },
        })
        .build();

      const emitted = run.commands.completeItem.handle(
        run.init(),
        { cost: 3 },
        run.events,
      );
      const folded = emitted.reduce((s, e) => run.apply(s, e), run.init());
      expect(folded.completed).toBe(1);
    });

    it("builds without commands for an aggregate fed by other pipelines", () => {
      expect(buildRun().build().commands).toEqual({});
    });
  });
});
