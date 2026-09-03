# @langwatch/group-queue

Typed Redis-backed work queues with FIFO processing inside a group and
concurrent progress across independent groups.

Define the transport contract once, then construct only the capability a
process needs:

```ts
import {
  defineGroupQueue,
  GroupQueueConsumer,
  GroupQueueProducer,
} from "@langwatch/group-queue";

const work = defineGroupQueue({
  name: "projection-work",
  payload: ProjectionWork,
  groupBy: (job) => `${job.projectId}/${job.aggregateId}`,
  identify: (job) => job.id,
});

const producer = new GroupQueueProducer(work, dependencies);
await producer.send(job);

const consumer = new GroupQueueConsumer(work, dependencies).handle(
  async (job, context) => {
    if (context.signal.aborted) return;
    await project(job);
  },
);
```

The payload object may be any schema exposing `parse(value)`, including a Zod
schema. `groupBy` and `identify` must return non-empty strings. The package
normalizes the logical name into a Redis Cluster hash-tagged transport name.

The persisted job representation is always the version 2 Group Queue envelope.
Values outside that contract are reported as decode failures and never reach a
handler.

Application policy is resolved before construction and passed as plain values
or narrow ports. Group Queue does not import application configuration,
feature flags, Eventing, or product telemetry.

Operational readers are available from `@langwatch/group-queue/operational`.
Redis scripts, Redis key helpers, and the internal processor are not public API.

See [the architecture decision](./adrs/20260820-group-queue-framework-boundary.md)
and [the behavioural contract](./specs/group-queue-framework.feature).
