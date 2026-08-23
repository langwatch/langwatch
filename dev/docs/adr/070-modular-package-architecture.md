# ADR-070: Packages enforce bounded contexts and one-way runtime dependencies

**Date:** 2026-07-21

**Status:** Accepted

**Related:** [Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md),
[Group Queue framework boundary](../../../packages/group-queue/adrs/20260820-group-queue-framework-boundary.md),
and [automation process managers](./052-automations-on-process-manager-substrate.md).

## Context

Runtime memory and typecheck cost both grow when browser code, server
implementations, database types and optional enterprise integrations belong to
one unrestricted module graph. Moving files into directories does not solve
that problem. Dependency direction has to be visible and enforceable.

LangWatch is a modular monolith. Package boundaries isolate contracts and
runtime footprints; they do not imply network calls, independent databases or
distributed transactions.

## Decision

The repository has three kinds of TypeScript package:

1. reusable frameworks with narrow public APIs;
2. product features with optional contract, server and web surfaces; and
3. application composition roots that assemble concrete processes.

### Framework dependency direction

```text
@langwatch/group-queue
  generic Redis transport
        ▲
        │ one-way runtime dependency
@langwatch/eventing
  events, pipelines, projections, subscribers,
  process managers and replay
        ▲
        │ public framework APIs
platform app / feature server packages
  product pipelines, repositories, adapters and policy
```

`@langwatch/group-queue` owns typed queue definitions, producers,
`GroupQueueConsumer`, canonical envelopes, ordering, fairness, retry,
coalescing and payload lifecycle. It has no knowledge of events, projections,
product features, the app or enterprise code.

`@langwatch/eventing` owns the reusable event-processing framework. It depends
on Group Queue for ordered background transport. It does not import the
platform app, product features, Prisma models or enterprise implementations.

The application owns product pipeline factories, the complete installed event
catalogue, pipeline registration, replay selection and concrete Postgres,
ClickHouse, Redis and observability adapters. Product policy does not move into
a framework merely because it uses that framework.

### Product features expose capability-specific surfaces

A feature may expose any subset of:

```text
feature/
  contract/   # DTOs, schemas, service interfaces, public vocabulary
  server/     # services, repositories, API handlers, pipeline composition
  web/        # React components, hooks and browser state
  adrs/       # lasting feature decisions
  specs/      # behavioural contracts
```

These surfaces are optional. A background-only feature may have no web or HTTP
API. A browser-only feature may have no repository. Directory names do not
create empty layers.

The contract surface is browser-safe and contains no Prisma, server framework,
Node-only or React implementation dependency. Server and web consume the
contract independently.

Cross-feature collaboration uses another feature's contract and service
interface. A feature never reaches into another feature's repository or
implementation directory.

### The app is a selective composition root

The app process serves browser and API traffic. The worker process starts
background consumers and process-manager dispatch. Additional ingestion or
compute processes may compose a smaller graph from the same packages.

Only a composition root imports concrete wiring factories. Other packages
receive dependencies through contract-owned interfaces. This keeps a process
from loading unrelated implementations merely because their types are visible
elsewhere in the repository.

The public REST/RPC API and internal tRPC API are transports over feature
services. Routers validate and translate; application behavior stays in the
service layer. The web imports API and feature contracts, never server
implementations.

### Prisma is contained at repository boundaries

The generated Prisma client remains one application schema. It is imported by
concrete repository adapters only.

- A repository accepts and returns feature-contract types.
- Prisma records and enums do not cross the repository boundary.
- Services depend on repository interfaces, not the generated client.
- Web, contracts, Eventing and Group Queue never import Prisma.
- A transaction is used only when a product invariant requires one; repository
  containment does not turn every service operation into a transaction.

This contains the connected Prisma type graph without splitting one physical
database into independently owned schemas that still share relations.

### Enterprise code is an optional composition seam

Core contracts define the seam that enterprise implementations satisfy. The
composition root installs enterprise capabilities only when available and
otherwise installs the core/null capability. Core frameworks and feature web
contracts never import enterprise implementations.

Enterprise features follow the same contract/server/web and repository rules;
their license or deployment condition does not grant them a reverse dependency
into package internals.

### Public APIs are sealed

Package `exports` maps expose deliberate roots and named subpaths. Deep imports
into `src`, repositories, executors, generated database types or app wiring are
unsupported and blocked by tooling.

CI enforces:

- an acyclic package graph;
- Group Queue has no Eventing, app, feature or enterprise imports;
- Eventing has no app, feature, enterprise or Prisma imports;
- browser packages have no server-value imports;
- cross-feature imports target public contracts/services;
- only composition roots import wiring factories; and
- package-owned ADRs and specs are discoverable by repository checks.

### Type and runtime boundaries align

Workspace packages emit declarations. Downstream packages typecheck public
contracts rather than re-evaluating every implementation file. Type-only
imports are used for injected service interfaces, but a `type` keyword is not
treated as an architecture boundary on its own: the package export map and
dependency rules still determine whether the edge is allowed.

The UI is a build-time consumer of browser-safe contracts and API types. A
Node process must not load React, Chakra, browser stores or page modules through
a server import chain.

## Alternatives considered

Directory conventions alone are easy to bypass and do not change module
resolution. A single `event-sourcing` package containing Redis transport,
product pipelines and database adapters would preserve cycles and prevent the
transport from being reused independently. Splitting Prisma generators without
splitting the relational model would add operational cost without isolating the
actual dependency graph.

Microservices remain an independent scaling decision. They are not required to
obtain these compile-time and process-footprint boundaries.

## Consequences

- Framework packages are independently understandable and testable.
- Product pipelines stay near product services while using a shared Eventing
  contract.
- Processes load only the concrete capabilities their composition root
  installs.
- Browser and server dependency graphs remain separate.
- Cross-feature calls are explicit service dependencies rather than repository
  reach-through.
- More dependencies must be named and injected, and public package surfaces
  require deliberate maintenance.
