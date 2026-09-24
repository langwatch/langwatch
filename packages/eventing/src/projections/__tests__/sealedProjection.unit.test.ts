import { describe, expect, expectTypeOf, it } from "vitest";

import { defineAggregate, defineEvents } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import type { SubscriberSpec, TriggerContext } from "../../pipeline/processManagerDefinition.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { FoldProjectionDefinition } from "../foldProjection.types.ts";
import type { MapProjectionDefinition } from "../mapProjection.types.ts";
import { sealFoldProjection, sealMapProjection } from "../sealedProjection.ts";

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

const finishedOnly: MapProjectionDefinition<{ ok: boolean }, Finished> & { name: "finishedOnly" } =
  {
    name: "finishedOnly",
    eventTypes: ["run.finished"],
    map: (event) => ({ ok: event.data.ok }),
    store: { append: async () => {} },
    options: { groupKeyFn: (event) => `finished:${String(event.data.ok)}` },
  };

const envelope = {
  aggregateId: "run_1",
  aggregateType: "trace",
  tenantId: createTenantId("tenant_1"),
  createdAt: 1,
  occurredAt: 1,
  version: "1",
} as const;
const started: RunEvent = { ...envelope, id: "e1", type: "run.started", data: { at: 1 } };
const finished: RunEvent = { ...envelope, id: "e2", type: "run.finished", data: { ok: true } };

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
    const register = () =>
      // @ts-expect-error the counter fold's state is { count: number }, not the outcome fold's
      runPipeline().withProjectionSubscriber("onCount", { fold: "counter", handler: onOutcome });
    expect(register).not.toThrow();
  });

  it("rejects a subscriber naming a fold the pipeline never registered", () => {
    const ignore = async () => {};
    expect(() =>
      // @ts-expect-error "missing" is not a fold on this pipeline
      runPipeline().withProjectionSubscriber("onMissing", { fold: "missing", handler: ignore }),
    ).toThrow(/projection not found/);
  });

  it("types a map projection's key and map functions with the events it declares", () => {
    const pipeline = runPipeline().withClickHouseMapProjection(finishedOnly);
    expectTypeOf(finishedOnly.map).parameter(0).toEqualTypeOf<Finished>();
    expect(pipeline.build().mapProjections.has("finishedOnly")).toBe(true);
  });

  it("admits to a map projection only the pipeline events it declares", () => {
    const sealed = sealMapProjection<{ ok: boolean }, Finished, RunEvent>(finishedOnly);
    const mapOf = (event: RunEvent) =>
      sealed.open((map, consumes) => (consumes(event) ? map.map(event) : null));
    const keyOf = (event: RunEvent) =>
      sealed.open((map, consumes) =>
        consumes(event) ? map.options?.groupKeyFn?.(event) : undefined,
      );
    expect(mapOf(started)).toBeNull();
    expect(mapOf(finished)).toEqual({ ok: true });
    expect(keyOf(started)).toBeUndefined();
    expect(keyOf(finished)).toBe("finished:true");
  });

  it("rejects mapping a pipeline event the map projection has not admitted", () => {
    const sealed = sealMapProjection<{ ok: boolean }, Finished, RunEvent>(finishedOnly);
    const unguarded = (event: RunEvent) =>
      sealed.open((map) =>
        // @ts-expect-error a pipeline event reaches map() only through consumes()
        map.map(event),
      );
    expect(unguarded).toBeTypeOf("function");
  });
});
