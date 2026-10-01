# Group Queue is a transport framework with one canonical job format

**Date:** 2026-08-20

**Status:** Accepted

**Behavioural contract:**
[../specs/group-queue-framework.feature](../specs/group-queue-framework.feature)

**Related:**
[the Eventing framework boundary](../../eventing/adrs/20260820-eventing-framework-boundary.md),
[Redis Cluster hash tags](./006-redis-cluster-hash-tags.md),
[the canonical payload envelope](./026-canonical-payload-envelope.md),
[content-addressed payload storage](./029-content-addressed-payload-store.md),
[payload cost](./069-payload-cost.md), and
[staged job identity](./080-staged-job-identity.md).

## Context

Group Queue is the ordered work transport beneath Eventing. Its package
boundary must keep application configuration, feature flags, tenant tracking,
Eventing types, storage destinations and application telemetry on the caller's
side. This gives the dependency one direction and makes the queue possible to
understand, test and reuse independently.

Group Queue has one job: accept typed work, preserve ordering and identity,
and deliver it safely. It must not know whether the work represents an event,
a projection, a subscriber, or a product operation.

## Decision

### 1. Package boundary

`@langwatch/group-queue` owns:

- the typed queue definition and its canonical persisted envelope;
- Redis queue mechanics;
- per-group FIFO ordering, fairness, admission, pause and retry behavior;
- deduplication, delay, coalescing and staged-job identity;
- payload compression, content-addressed offload, leases and reclamation;
- poison/error handling and explicit loss accounting;
- consumer draining and queue-level shutdown behavior;
- narrow ports for context, activity, failure policy and payload storage.

It does not own:

- events, commands, aggregates, projections, subscribers or process managers;
- pipeline names or application dispatch policy;
- application configuration, feature flags, tenant accounting, billing or
  retention policy;
- the application lifecycle or connection shutdown order;
- concrete product telemetry.

Eventing may depend on Group Queue. Group Queue may never depend on Eventing,
the platform app, or enterprise code.

### 2. One definition, two capabilities

A queue is described once with `defineGroupQueue()`. The definition fixes its
name, payload schema, grouping rule and identity rule. Runtime wiring creates
two deliberately different capabilities from that definition:

```ts
const projectionWork = defineGroupQueue({
  name: "projection-work",
  payload: ProjectionWork,
  groupBy: (job) => job.aggregate.id,
  identify: (job) => job.id,
});

const producer = new GroupQueueProducer(projectionWork, producerDependencies);

const consumer = new GroupQueueConsumer(projectionWork, consumerDependencies).handle(
  async (job, context) => {
    // context contains delivery attempt and cancellation
  },
);
```

`GroupQueueConsumer` is the public name for the consuming runtime. “Worker” is
reserved for an application process role and is not part of this package's
authoring vocabulary.

A producer cannot register a handler, claim groups, or drain consumers. A
consumer cannot bypass the definition's decoder or invent a second identity
rule. Raw BullMQ and Redis handles are internal.

### 3. Jobs use one persisted format

`GroupQueueEnvelope` is the canonical persisted job format. Its version stays
explicit because durable data formats need stable versioning.

A stored value that is not a valid v2 envelope is an unsupported value. It is
classified and reported through the existing loss/error path, never passed to
an application handler and never counted as successful work. Recoverable body
data is not destroyed while reporting a decode failure, and a malformed job
must not wedge the rest of its group.

### 4. Policy is injected as data, not imported as services

Group Queue and Eventing do not import a feature flag service. A caller that
needs a different queue policy resolves it before construction and supplies a
plain, validated configuration value. The queue does not call application
policy services while staging or consuming work.

The same rule applies to observability and tenancy. The package emits through
small interfaces and accepts opaque attribution fields; it does not import the
app's metrics, context, or tenant tracker.

### 5. Misuse is blocked at the boundary

The package will enforce these rules with all of the following:

- an `exports` map that exposes supported entry points and makes deep imports
  unresolvable;
- a package boundary check forbidding app, enterprise and Eventing imports;
- a typed builder whose result cannot be constructed without payload,
  grouping and identity rules;
- runtime schema validation at the persisted-data boundary;
- closed error classifications rather than exception-message matching;
- contract tests shared by producer and consumer;
- type tests proving the producer and consumer capabilities cannot be mixed.

The package root exports authoring types and factories. Operational inspection
helpers, test fixtures and concrete Redis adapters use explicit subpath
exports; internal scripts and key layout helpers are not public API.

### 6. Documentation states the live contract

Comments remain where they explain an invariant, a non-obvious failure mode or
a Redis atomicity requirement. Operational behavior already covered by a
package spec does not need an essay beside every branch that implements it.

Framework ADRs and specs live under `packages/group-queue/`. Product-specific
queue scenarios remain with their owning feature. Every decision and
behaviour has one live source of truth.

## Alternatives considered

Keeping Group Queue inside Eventing would reduce the immediate number of
packages, but it would preserve the semantic coupling and prevent other
transports from using the ordered queue safely.

Keeping one `GroupQueue` object with optional producer and consumer methods
would require runtime guards for invalid combinations. Separate capabilities
make the allowed operations visible in types and in process composition.

## Consequences

- Group Queue can be typechecked and tested without the app or Eventing.
- Eventing is a normal one-way consumer of a transport package.
- Producer-only web processes cannot accidentally start consumers.
- Queue definitions are the single source of grouping, payload and identity
  semantics.
- Stored values outside the canonical envelope contract are rejected rather
  than interpreted heuristically.
- Application observability and policy wiring belongs to adapters at the
  composition root.
