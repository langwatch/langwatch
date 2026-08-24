# ADR-001: Agents is a contract, server and web feature

**Date:** 2026-08-21

**Status:** Accepted

**Behavioural contract:**
[Agents package boundary](../specs/package-boundary.feature)

**Related:**
[ADR-101: feature package surfaces](../../../../dev/docs/adr/101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](../../../../dev/docs/adr/102-runtime-composition-roots.md),
and [package-boundary enforcement](../../../architecture-lint/adrs/001-feature-package-boundaries.md).

## Context

The Agents feature owns reusable agent definitions: code agents, workflow
agents, HTTP agents and the compatibility shapes still accepted by existing
clients. It is not the coding-agent observability feature. Coding-agent
sessions, trace normalization, projections and pull-request usage remain in
their current owner and are not part of this extraction.

Agents is a useful first feature-package extraction because its durable core is
small. The current implementation has one Prisma-backed repository, one service
and thin tRPC and REST adapters. Its browser surface is larger, but already has
a recognizable set of drawers, editors and screens that all consume the same
agent vocabulary.

The current boundary is nevertheless porous. Agent DTOs are derived from
generated Prisma records, browser code imports types from the server
repository, config validation lives in the Optimization Studio DSL module, the
service queries Prisma directly for workflows and audit history, and both API
adapters construct their own service from the global Prisma client. The tRPC
router also owns orchestration and permission details that are not agent
business behaviour.

The public REST interface is already used by SDK, CLI and agentic clients, so
removing it is not part of this work. The browser should gain a clean
package-owned RPC interface without creating a second implementation of CRUD,
copy, synchronization or archival behaviour.

## Decision

Create three physical workspace packages under one feature ownership root:

```text
packages/features/agent/
├── contract/                              # @langwatch/agent-contract
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── agent.ts                       # Agent, AgentId and AgentType
│   │   ├── config/                        # portable discriminated configs
│   │   │   ├── fields.ts
│   │   │   ├── code.ts
│   │   │   ├── workflow.ts
│   │   │   ├── http.ts
│   │   │   └── index.ts
│   │   ├── agent.commands.ts              # create/update/archive/copy inputs
│   │   ├── agent.queries.ts               # list/detail/history DTOs
│   │   ├── agent.service.ts               # abstract public service capability
│   │   ├── agent.errors.ts                # concrete domain errors + problem schemas
│   │   └── index.ts                       # the only public entry point
│   └── tests/
│
├── server/                                # @langwatch/agent-server
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── services/
│   │   │   └── agent.service.ts
│   │   ├── adapters/
│   │   │   └── prisma.agent.adapter.ts     # binds private persistence to the service
│   │   ├── repositories/
│   │   │   ├── agent.repository.ts        # private port
│   │   │   └── prisma/
│   │   │       ├── prisma.agent.mapper.ts
│   │   │       └── prisma.agent.repository.ts
│   │   ├── ports/
│   │   │   └── agent.port.ts              # workflow, audit and database ports
│   │   ├── api/
│   │   │   ├── internal/
│   │   │   │   └── agent.api.ts          # AgentsRpcApi adapter class
│   │   │   └── legacy-rest/
│   │   │       └── agent.api.ts          # LegacyAgentsRestApi adapter class
│   │   └── index.ts
│   └── tests/
│
├── web/                                   # @langwatch/agent-web
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── client/                        # browser-safe agent client port
│   │   ├── components/
│   │   ├── drawers/
│   │   ├── screens/
│   │   ├── provider/                      # injected client + app capabilities
│   │   └── index.ts
│   └── tests/
│
├── adrs/
└── specs/
```

The ownership root declares `layoutVersion: 0` in `feature.json` and follows
the versioned strict feature layout.

### Contracts and validation

The contract owns agent identifiers, timestamps, types, field shapes, config
schemas, inputs, outputs, pagination, concrete domain errors and the service
capability. Zod schemas are the source of truth for these transport-safe values;
TypeScript types are inferred from them and the contract compiles independently.
These values are defined independently of Prisma and then reused by
Optimization Studio. The Studio DSL may adapt or re-export the portable agent
config shapes; the contract does not import the Studio module.

The four persisted agent types remain readable while product UI may offer a
smaller creation set. Compatibility types such as `signature` are not deleted
as a side effect of moving the boundary.

No contract value is a generated Prisma record. Dates and JSON are represented
deliberately in transport-safe DTOs, and the Prisma mapper performs conversion
at the repository edge.

### Persistence

`AgentService` implements the contract capability and receives an
`AgentRepository` plus narrow workflow, audit-log and authorization ports. It
does not receive a Prisma client and does not construct its dependencies.

`PrismaAgentAdapter` is the deliberate class composition surface that binds the
private Prisma repository to `AgentService`. The app runtime supplies the
database and cross-feature ports but cannot import the repository itself.

The repository interface is private to the server package. The concrete Prisma
adapter is the only Agents source directory allowed to import the generated
Prisma client. It may query the connected schema needed to assemble an agent
view, but it returns contract DTOs and cannot be imported through the package
export map.

### Dependencies

Cross-feature work such as copying or archiving a linked workflow is performed
through an injected capability. Agents server does not import a Workflows
server implementation. Until Workflows has its own contract package, the app
composition root supplies a narrow adapter matching the Agents port.

### Public surfaces and transports

The server package exports an installer for a package-owned tRPC router
fragment. The app mounts that fragment at the existing `agents` namespace and
the Agents web client uses it through the app's browser API composition.

The existing `/api/agents` REST contract remains mounted and documented in
OpenAPI as Legacy with `deprecated: true`. It becomes a compatibility adapter
over the same `AgentService` commands and queries used by tRPC. “Proxy” here
means forwarding through the same in-process application capability, not making
an HTTP request from the REST handler back into the internal server. REST owns
API-key authentication, HTTP status mapping and public response compatibility;
tRPC owns product-user authentication and internal error mapping. Neither owns
agent behaviour and neither calls the repository directly.

Both adapters import request and response schemas from
`@langwatch/agent-contract`. tRPC uses them for runtime input validation and
inferred types. The REST adapter uses the same schemas for request validation
and feeds them through `hono-openapi`'s Standard Schema API for detailed
OpenAPI request/response models. It does not use the Hono-specific Zod adapter
or import `zod/v3`. The generated specification is therefore a view of the
contract's compiled Zod 4 schemas, not a separately maintained set of API
types. Concrete errors are mapped at each transport boundary; the contract
problem schema is the portable problem DTO, while deprecated REST preserves
its established shared error envelope.

The deprecated REST API remains authenticated, authorized and compatibility
tested. It is not extended with new product-only operations, and no sunset date
is claimed until a separate decision defines one. The generated documentation
points new integrations to RPC while still telling existing clients exactly
what remains supported.

The request context receives an already-instantiated application object. RPC
handlers call `ctx.app.agents` and never call a global `getApp()`, import the
global Prisma client, or construct services and repositories inside procedures.
Request context construction composes the service once, while tests may inject
a small fake application object. The app-owned tRPC and Hono shells add
authentication and authorization before delegating to the same service.

### Web is browser-safe and host capabilities are injected

The web package owns agent-specific screens, cards, drawers, editors and hooks.
It depends on Agents contract, React, Chakra and
`@langwatch/design-system`. It does not import Agents server, app aliases,
Prisma, tRPC server types or Optimization Studio server code.

The app retains route files as thin shells and supplies navigation, current
project context, the composed internal API client and cross-feature UI such as
a workflow picker. This avoids a web-to-web feature dependency while the
Workflows feature has not yet been extracted.

### Runtime and registration

Importing a package has no side effect. The internal server composition root
installs the tRPC fragment; the public API root installs the REST adapter; the
browser app mounts the web provider and route shell. Agents has no worker
installer because it owns no background transport in this phase.

Existing `specs/agents` behaviour and lasting Agents ADRs move under this
feature root as their implementations move. Coding-agent session specs and ADRs
do not move with them.

### Environment and configuration

Agents packages do not read `process.env`, `import.meta.env` or the app T3 env
module. The app composition root validates environment once and passes any
future Agents configuration as a narrow typed value. Agents currently needs no
feature-specific environment configuration.

### Errors

Singular service reads either return an Agent or throw a concrete error. In
particular, `AgentNotFoundError` carries the requested agent and project IDs;
the service does not return `null`, expose a `notFound()` helper or publish an
error-code registry. Repositories may use `null` for persistence lookup
absence, but that value never crosses the service boundary. RPC and REST map
the same concrete errors once at their transport boundaries.

## Alternatives considered

Moving only the current server folder would leave browser code importing
repository types and would keep validation owned by the app DSL. Moving the
whole Optimization Studio into Agents would reverse ownership: Studio consumes
agent definitions but is not part of the Agents feature.

Making REST call tRPC over HTTP would add an internal network hop, duplicate
authentication translation and couple the public API's availability to the
internal transport. Both adapters calling the same injected service gives one
implementation without those costs.

Keeping the repository public for “reuse” would let evaluation and scenario
code bypass business rules. Those consumers use the Agents contract service
capability instead.

## Consequences

- Agents becomes the first complete contract/server/web feature example.
- Internal RPC and legacy REST share one service implementation.
- RPC is the standard surface for new Agents clients; REST remains documented,
  operational and explicitly deprecated.
- Browser and cross-feature consumers stop importing server repository types.
- Prisma is contained to a private mapper and repository adapter.
- Optimization Studio must consume portable agent config schemas instead of
  owning them.
- Workflow and app-specific behaviour require explicit injected adapters.
- Existing REST compatibility remains a maintained public contract.
