# ADR-001: One Prompt service boundary

**Status:** Accepted

**Behavioural contract:** [Prompt service](../specs/prompt.feature)

## Context

Prompt configurations, immutable versions, tag assignments and copy/sync
behaviour currently span `server/prompt-config`, the Prompt tRPC router and
the `/api/prompts` compatibility API. Those callers construct services and
repositories independently, making the persistence model part of every
transport.

## Decision

Prompt owns prompt configurations, immutable versions, handles, copies and
custom tags. It is one singular feature; tags and versions are subordinate
behaviour, not separate packages.

`@langwatch/prompt-contract` is the portable boundary. It owns Zod 4 schemas,
transport-safe values, prompt errors and the abstract `PromptService`
capability. It has no Prisma, Hono, tRPC, React, environment or application
imports.

`@langwatch/prompt-server` owns the concrete service and its private
`PromptRepository` port. A future Prisma adapter belongs below
`server/src/repositories/prisma/` and maps generated rows into contract values;
generated Prisma types must not cross the package export.

The existing tRPC names and `/api/prompts` REST paths remain compatibility
transports. They delegate to the process-owned Prompt service and retain their
current authentication, permission, response and error mapping. No transport
constructs a repository or service per request.

Prompt is allowed to collaborate with Model Provider through that feature's
contract only. Prompt does not import the model-provider server implementation,
the UI schema tree, or a global Prisma client.

### Public surfaces and transports

The existing tRPC procedure names and `/api/prompts` REST paths remain
compatibility transports. They delegate to the process-owned Prompt service.

### Dependencies

Prompt may consume Model Provider behaviour through its contract. It does not
import Model Provider server code or application modules.

### Persistence

The server package owns a private repository port. A future Prisma adapter is
the only place generated Prisma types may be imported, under
`server/src/repositories/prisma/`.

### Runtime and registration

The application composition root builds one service with
`PromptServiceAdapter`; Hono, tRPC and workers receive that same capability.
Requests do not construct Prompt services.

### Environment and configuration

Prompt reads no environment values during module import. Runtime configuration
is supplied by the application boot boundary.

### Errors

Prompt domain errors are portable contract errors. Compatibility transports map
them to their existing HTTP and tRPC envelopes.

### Contracts and validation

Zod 4 schemas in the contract package validate commands and values. The service
validates before calling the repository, and repository adapters parse mapped
rows before returning them.

## Consequences

The app can compose one Prompt service and expose it through Hono, tRPC,
workers and future RPC without changing the public URL surface. The existing
legacy implementation can be migrated behind the repository port incrementally
while the compatibility routes remain stable.
