import { describe, expect, expectTypeOf, it } from "vitest";

import { defineAggregate, defineEvents } from "../../domain/definitions.ts";
import type { Event } from "../../domain/types.ts";
import type { SubscriberSpec, TriggerContext } from "../../pipeline/processManagerDefinition.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { FoldProjectionDefinition } from "../foldProjection.types.ts";
import { sealFoldProjection } from "../sealedProjection.ts";

type Started = Event<{ at: number }> & { type: "run.started" };
type Finished = Event<{ ok: boolean }> & { type: "run.finished" };
type RunEvent = Started | Finished;

const counter: FoldProjectionDefinition<{ count: number }, RunEvent> & { name: "counter" } = {
  name: "counter",
  version: "1",
  LastEventOccurredAtKey: "lastEventOccurredAt",
  eventTypes: ["run.started", "run.finished"],
  init: () => ({ count: 0 }),
  apply: (state) => ({ count: state.count + 1 }),
  store: {
    store: async () => {},
    get: async () => ({ kind: "empty" }),
  },
};

const outcome: FoldProjectionDefinition<{ ok: boolean }, RunEvent> & { name: "outcome" } = {
  ...counter,
  name: "outcome",
  init: () => ({ ok: false }),
  apply: (state) => state,
  store: { store: async () => {}, get: async () => ({ kind: "empty" }) },
};

function runPipeline() {
  return definePipeline<RunEvent>({
    name: "run",
    aggregate: defineAggregate({
      type: "trace",
      events: defineEvents(["run.started", "run.finished"] as const),
    }),
  })
    .withClickHouseFoldProjection(counter)
    .withClickHouseFoldProjection(outcome);
}

describe("sealed projections (ARCHITECTURE §9)", () => {
  it("opens a sealed fold with its state type intact", () => {
    const initial = sealFoldProjection(counter).open((fold) => fold.init());
    expect(initial).toEqual({ count: 0 });
  });

  it("rejects a fold whose apply narrows its pipeline's event type", () => {
    const narrowApply = (state: { count: number }, _event: Started) => state;
    expectTypeOf(narrowApply).not.toMatchTypeOf<
      FoldProjectionDefinition<{ count: number }, RunEvent>["apply"]
    >();
    const narrowed: FoldProjectionDefinition<{ count: number }, RunEvent> = {
      ...counter,
      // @ts-expect-error a handler declaring a narrower event than its pipeline is rejected
      apply: narrowApply,
    };
    expect(narrowed.name).toBe("counter");
  });

  it("rejects a subscriber handler that narrows its pipeline's event type", () => {
    const narrowHandler = async (_event: Started) => {};
    expectTypeOf(narrowHandler).not.toMatchTypeOf<SubscriberSpec<RunEvent>["handler"]>();
  });

  it("types a projection subscriber with its fold's state through the fold's name", () => {
    const pipeline = runPipeline().withProjectionSubscriber("onCount", {
      fold: "counter",
      handler: async (_event, context) => {
        expectTypeOf(context.state).toEqualTypeOf<{ count: number }>();
      },
    });
    expect(pipeline.build().foldSubscribers.has("onCount")).toBe(true);
  });

  it("rejects a subscriber declaring another fold's state", () => {
    const onOutcome = async (_event: RunEvent, _context: TriggerContext<{ ok: boolean }>) => {};
    // @ts-expect-error the counter fold's state is { count: number }, not the outcome fold's
    runPipeline().withProjectionSubscriber("onCount", { fold: "counter", handler: onOutcome });
  });

  it("rejects a subscriber naming a fold the pipeline never registered", () => {
    const ignore = async () => {};
    expect(() =>
      // @ts-expect-error "missing" is not a fold on this pipeline
      runPipeline().withProjectionSubscriber("onMissing", { fold: "missing", handler: ignore }),
    ).toThrow(/projection not found/);
  });
});
