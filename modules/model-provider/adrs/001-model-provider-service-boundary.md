# ADR-001: One Model Provider service boundary

**Status:** Accepted

**Behavioural contract:** [Model Provider service](../specs/model-provider.feature)

## Context

Provider configuration, default-model resolution, custom model costs, API-key
validation, and translation were spread across request middleware, tRPC
routers, and application-owned Prisma repositories. That made transport code
construct services repeatedly and made the persistence shape part of every
caller.

## Decision

The Model Provider feature exposes one portable abstract `ModelProviderService`
from its contract package. The contract uses Zod 4 schemas and contains no
Prisma, transport, environment, or application imports.

The server package implements that contract once. Its persistence repositories,
Prisma generated types, and provider SDK details are private. The only public
server composition surface is `PostgresModelProviderAdapter`; it accepts an
opaque database object plus narrow catalog, managed-provider, and translation
ports and builds the service once during application composition.

REST and tRPC remain compatibility transports. They preserve their existing
URLs, validation, response mapping, masking, and errors while delegating to the
process-owned service through `c.var.langwatchApp` or `ctx.app`. Managed
providers are an optional service collaborator, not a foreign repository.

Nullable lookup boundaries are explicit: methods that may not find a value are
named `try*` (`tryFindById`, `tryGetById`, `tryResolve`, and
`tryGetResolvedDefault`). Required operations throw a feature-owned error.
Callers do not repeat repository absence checks at the service boundary.

### Public surfaces and transports

The contract package exports provider, default-model, cost, translation values,
errors, schemas, and the single abstract service. The server root exports the
Postgres composition adapter, construction ports, and the two app-tRPC API
classes below. Existing model provider, model-cost, default-model, and
translate REST surfaces remain compatibility adapters.

The internal tRPC transports are package-owned. `ModelProviderTrpcApi`
(`modelProvider.*`) and `LlmModelCostTrpcApi` (`llmModelCost.*`) live in
`server/src/api/app-trpc/` and own the procedure names, input and output
shapes, and delegation to the service. The process mounts them from
`platform/app/src/runtime/app/internal-api/model-provider.router.ts`, which
supplies the tRPC root, the authenticated procedure, the authorization policy
chain, and the ports the transports cannot own themselves: the outbound
credential probes, the Codex device flow, the audit trail, the regex-safety
predicate, the model-limit lookup, and the span-preview reader.

The policy is applied by the feature AFTER its own `.input()`, never composed
ahead of it: tRPC appends its parser as a middleware at the point `.input()`
is called, so a check installed earlier reads `input === undefined` and every
declaration that resolves a scope id from the input would pass on nothing.

### Dependencies

Other features depend only on `@langwatch/model-provider-contract`. The server
implementation may depend on narrow feature contracts and private persistence
ports. Application code supplies provider catalog and SDK behavior through
ports; the Model Provider package does not import application modules.

### Persistence

Model provider, default configuration, and model-cost rows are persisted by
private Prisma repositories under `server/src/repositories/prisma/`. Generated
Prisma types do not cross the adapter boundary.

### Runtime and registration

Each process constructs one Model Provider service as part of the App instance.
Hono receives it through `c.var.langwatchApp`, and tRPC receives it through
`ctx.app`. No request creates a service or repository.

### Environment and configuration

The feature reads no environment values during module import. Provider
catalogs, SDK access, and configuration are validated by application boot and
injected through the catalog and translation ports.

### Errors

Unknown providers and missing required records throw Model Provider domain
errors. Optional lookups use the `try*` naming convention and return `null`.
Transport adapters preserve the existing error mapping.

### Contracts and validation

All feature inputs and outputs are parsed with Zod 4 schemas at the service
boundary. Persistence mappers parse database rows before returning contract
values. Credentials are masked before summaries leave the service.

## Consequences

Provider policy and persistence composition have one implementation and one
runtime lifetime. Legacy REST and tRPC callers can migrate independently, while
new callers use the contract service. Private repositories and Prisma details
cannot become accidental cross-feature dependencies. Existing legacy helpers
remain only where an unmigrated compatibility path still requires them.
