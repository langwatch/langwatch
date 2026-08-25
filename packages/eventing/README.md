# Eventing

`@langwatch/eventing` owns the reusable event-driven application framework:
events, aggregates, pipelines, commands, projections, subscribers, process
managers, replay, and the ports needed to run them. Product pipelines,
registries, persistence adapters, and runtime composition belong to the app or
feature package that uses it.

Eventing depends on `@langwatch/group-queue` for generic Redis transport. Group
Queue does not depend on Eventing.

## Define a pipeline

```ts
import { defineAggregate, defineEvents, definePipeline } from "@langwatch/eventing";

export const orders = definePipeline<OrderEvent>({
  name: "orders",
  aggregate: defineAggregate({
    type: "order",
    events: defineEvents(ORDER_EVENT_TYPES),
  }),
})
  .withClickHouseFoldProjection(orderSummary)
  .withClickHouseMapProjection(orderRows)
  .withPostgresProjection(orderWorkflow)
  .withProjectionSubscriber("notify", {
    fold: "orderSummary",
    events: ["order.completed"],
    handler: notifyOrderCompleted,
  })
  .withEventSubscriber("audit", auditSubscriber)
  .withProcessManager(orderSettlement)
  .withCommand("placeOrder", PlaceOrderCommand)
  .build();
```

The projection method names intentionally expose the persistence substrate:

- `withClickHouseMapProjection` replaces rows derived independently from events.
- `withClickHouseFoldProjection` loads, evolves, and stores aggregate state and
  requires the app's Redis consistency adapter.
- `withPostgresProjection` runs a direct repository load/evolve/store cycle.

Use `withProjectionSubscriber` only when work needs committed fold or map state.
Use `withEventSubscriber` when it only needs the committed event. Use a process
manager for durable, stateful orchestration.

## Package boundaries

- Import framework contracts from the package root.
- Import test helpers from `@langwatch/eventing/testing` only in tests.
- Bind ClickHouse, Postgres, Redis, object storage, and product services in the
  application composition root.
- Declare every durable event in exactly one aggregate. The runtime event
  catalogue rejects unknown event types and duplicate ownership.

The current decisions live in [adrs](./adrs/README.md), executable behaviour in
[specs](./specs), and reaction semantics in [REACTIONS.md](./REACTIONS.md).
