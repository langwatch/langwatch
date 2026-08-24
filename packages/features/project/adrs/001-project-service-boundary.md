# ADR-001: One Project service boundary

**Status:** Accepted

**Behavioural contract:** [Project service](../specs/project-service.feature)

## Context

Project behaviour currently appears in the application service and in a
caller-specific Governance project repository. Those implementations can
diverge on creation policy, authorization, generated identity, and concurrent
creation even though they operate on the same durable project lifecycle.

## Decision

Project behaviour is exposed through one portable `ProjectService` contract
and one process-owned implementation. Features receive that service through
composition. They do not define project repositories, create project services,
or query project persistence themselves. The service owns project creation,
settings changes, archive policy, project-key rotation, metadata activity,
presence and trace-sharing reads, including the personal-workspace invariants.

### Public surfaces and transports

The contract package exports portable Zod 4 values, handled project errors,
and the single abstract `ProjectService`. Existing REST and tRPC routes remain
compatibility transports and delegate to the service obtained from app context.

### Dependencies

The server implementation consumes narrow injected contracts for Organization,
Authz, stored objects, diagnostics, identity generation, and query parsing.
Other features depend only on `@langwatch/project-contract`, never its server
package.

### Persistence

Project persistence is owned by a private Prisma repository in the Project
server package. It maps generated database values to portable contract values
and keeps uniqueness-race handling inside Project. Team selection and team
creation belong to the Organization service and Project never queries Team
persistence. Stored-object cleanup, LWQL key-map synchronisation and
diagnostics are injected narrow capabilities; they are not repositories
recreated by callers.

### Runtime and registration

Each API or worker process constructs one Project service in its application
graph. Hono reads that graph from `c.var.langwatchApp`, tRPC reads the same
instance from `ctx.app`, and handlers never construct a repository per request.

### Environment and configuration

Project code reads no environment values at module import. The boot root
validates configuration and injects concrete generators, feature switches, and
query capabilities when it creates the process-owned service.

### Errors

Project errors identify the affected project or organization without exposing
persistence details. Transports map these errors once; repositories do not
return Prisma errors across the service boundary.

### Contracts and validation

All transport-facing and cross-feature values use Zod 4 schemas from the
contract root. Internal and application projects share the same portable
identity model, with project kind making internal lifecycle operations explicit.

## Consequences

Project lifecycle policy has one implementation and one repository owner.
Governance consumes `ProjectService` rather than owning a Governance project
stack, while compatibility routes retain their current URLs during migration.
