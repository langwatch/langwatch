# ADR-110: The engine is a package, the pipelines and the wiring are the application

**Date:** 2026-07-30

**Status:** Accepted — supersedes ADR-102. The boundary rule is unchanged; what
changes is that the move it prescribed is now actually being made, and the
document records why the previous attempt produced nothing.

**Supersedes:** ADR-102 (package topology and composition).

**Related:** ADR-107 (what a pipeline declares), ADR-108 (the runtime this
package holds), ADR-109 (the storage package it depends on through contracts).

## Context

ADR-102 decided the core moved to `packages/event-sourcing` and the pipelines
stayed in the application. Its migration order was: fix the leaks, move the
pipelines, create the package, then move the core and land the boundary test in
the same commit.

Steps one through three happened. Step four did not. The declaration half —
`definePipeline`, the mount checker, the fold and map executors, the group-key
renderer — reached the package. The runtime half never did: the event store, the
command bus, the queue, the process-manager runtime, replay and the composition
root stayed in the application tree, which was renamed `event-sourcing.old` and
then deleted. The result is a package that can describe a pipeline and cannot run
one, and an application that imports a runtime that no longer exists in 267
files.

The lesson is about sequencing, not about the boundary. ADR-102 was right that
the residual coupling was small — 58 port statements — and right that a test is
the only thing that keeps it small. What it underestimated is that a half-moved
subsystem is worse than either end state: the declaration half was accepted as
"the migration", the runtime half was reclassified as legacy, and deleting the
legacy tree deleted the engine.

So this ADR restates the boundary and adds one rule the previous one lacked: the
package is not done until it can run a pipeline end to end without the
application.

## Decision

### 1. Four layers, each depending only on the one above

| layer | home | owns |
| --- | --- | --- |
| engine | `packages/event-sourcing` | declaration, execution, dispatch, process runtime, replay, and every **port and store contract** |
| storage | `packages/clickhouse` | `defineTable`, the codec, the client, ClickHouse **implementations** of those contracts |
| dispatch substrate | `packages/groupqueue` | the Redis **implementation** of `LaneQueue` and `BlobSpool` — lanes, leases, the atomic claim, the spool |
| repositories | `app-layer/<domain>/repositories` | domain reads and writes, built on the storage package |
| pipelines | `event-sourcing/<name>/` | a domain's commands, events, projections, process managers |

**An implementation package depends on the engine package, and never the
reverse.** `packages/clickhouse` already declares `@langwatch/event-sourcing` as
a workspace dependency and imports `AppendStore`, `ReplaceStore` and
`BatchContext` from it, which is correct: a contract is only worth having if the
implementor compiles against it. `packages/groupqueue` does the same for
`LaneQueue` and `BlobSpool`. The engine depends on neither, which is what the
boundary test in decision 3 enforces, and the application wires all three
together.

The dispatch substrate is a package rather than application code for the same
reason storage is. It is generic infrastructure with no domain in it, it is the
most intricate piece of the system, and it needs its own test suite against a
real Redis — none of which it gets sitting in the application beside the
pipelines it serves.

That ordering is also the dependency direction and it is forced, not chosen: the
engine cannot depend on ClickHouse without ceasing to be testable in isolation,
and the storage package has consumers — analytics query builders, governance
services, ops explain paths — that read ClickHouse without touching a projection.
Putting table definitions in the engine would make those callers either unable to
use them or obliged to take an event-sourcing dependency to run a query.

### 2. The engine holds contracts, never implementations

What the engine declares is the set of ports in ADR-108 decision 13 —
`EventLog`, `LaneQueue`, `BlobSpool`, `ProcessStore`, `Outbox`, `Clock`,
`Metrics`, `Tracing` — plus the store contracts: load a state, store a state,
append records, append a batch.

ClickHouse implements some; Redis implements others; Postgres implements the
process store. That last one is not hypothetical, and it is the reason the
contract is a contract: an operational fold already keeps its state in a Postgres
row, and an engine that knew about ClickHouse would have made that adopter an
exception rather than an ordinary case of the same interface.

### 3. The package may not import application code, and a test says so

The boundary is a test in the package, not a convention in a docblock. It walks
every file under `packages/event-sourcing/src`, resolves every import specifier,
and fails on any that leaves the package other than to a declared dependency.
`~/`, `@ee/` and relative paths back into the application all fail, and the test
catches type-only, side-effect-only and dynamic imports.

Anything the engine needs from the application is an injected port declared in
the package's own types. Two families need care because they are enumerations the
application owns and the engine switches on — the retention policy and the
feature-flag registry — and both cross as an opaque resolver function, never as
the enum.

### 4. The package is not done until it runs a pipeline without the application

This is the rule ADR-102 lacked. The package ships an in-memory implementation of
every port and a test that registers a pipeline, dispatches a command, and
asserts the fold, the map, the subscriber and the process manager all ran — with
no ClickHouse, no Redis, no Postgres and no application import.

That test is the definition of "the engine moved". Without it, a package
containing declarations and executors reads as complete while nothing can execute
a delivery, which is exactly the state that made deleting the legacy tree look
safe.

### 5. The composition root is application code, and it is the only place that names both

One module registers every pipeline, constructs each store by wrapping a
repository in the store kinds of ADR-109, supplies every port, and hands the
result to the service. It is the only place that may name both a concrete
repository and a projection, and its return type is the application's command
surface.

Its length is the honest size of the wiring. Splitting it distributes the answer
to "what is mounted in this deployment" across files that would each have to be
read to reconstruct it. Its many outbound imports are not a smell in a file whose
job is to name concrete collaborators; they are the job.

**Enterprise mounts cross here, as pre-built members.** `ee/` cannot be imported
unconditionally from an open-source pipeline file, so an enterprise projection or
subscriber is constructed in the enterprise composition and injected behind an
`if` guard. ADR-107 decision 17 requires the builder to accept a pre-built
member for exactly this reason: the previous mount surface offered only record
literals typed against the pipeline's own vocabulary, which is why five
enterprise mounts had no representable shape and were silently absent.

### 6. Whether a process runs the consumer loops is one predicate

There are four process roles and exactly one test for whether a role hosts the
worker stack: `roleRunsWorkers(role)`, true for `worker` and `all`. No site
compares a role to a string literal.

Registration is unconditional; consumption is gated. Every role builds the same
pipeline graph, so introspection, command dispatch and type surfaces are
identical everywhere; only the consumer loops start where the predicate holds.
The package receives a boolean and knows nothing about roles, because a role is a
property of the deployment.

## Rationale / Trade-offs

**Why the root `packages/`, not the application's own package set?** The
application's packages are internal utilities that ship with its build. The root
set holds contract packages — source-only, peer-dep'd, consumed by more than the
application. The engine defines the vocabulary anything agreeing with `event_log`
must speak, and putting it inside the tree it is not allowed to import from
leaves only the boundary test between it and a relative path back up.

**Why does the runtime belong in the package when the pipelines do not?** Because
they are versioned by different things. The runtime is versioned by correctness
decisions; the pipelines are versioned by product decisions. The previous shape
had no mechanism preventing a core primitive from importing a pipeline, and one
did — a generic fold-store definition importing a pipeline helper, one line,
invisible in review, which made the primitive un-extractable.

**Why an in-memory port implementation, when production never uses it?**
Because decision 4 needs it, and because it is the cheapest available proof that
the ports are ports. A contract that has exactly one implementation is a
description of that implementation.

## Consequences

- **The engine becomes independently testable and independently type-checked.** A
  core change is checked against a few dozen files rather than the application's
  whole program.
- **Decision 4's end-to-end test makes "half-moved" a failing state** rather than
  a plausible-looking milestone.
- **The 267 dangling references are repointed** at the package, and the ones that
  reach for a runtime type the package deliberately does not export become
  visible as design questions rather than mechanical renames.
- **The enterprise seam gains a representable shape**, and the five missing
  mounts become wiring rather than a builder change.
- The package's public surface starts wide and stays whatever the application
  imports. Narrowing it is separate work with its own test; until then the
  boundary test guards the direction of dependency but not the size of the
  interface.

## References

- `packages/event-sourcing/src/purity.unit.test.ts` — decision 3's boundary test.
- `packages/event-sourcing/src/runtime/` — decisions 1 and 2.
- `platform/app/src/server/app-layer/config.ts` — `roleRunsWorkers`.
- `specs/event-sourcing/package-boundaries.feature` — decisions 3 and 4.
- ADR-107, ADR-108, ADR-109.
