# ADR-001: Annotation has one service boundary

**Status:** Accepted

**Behavioural contract:** [Annotation service](../specs/annotation-service.feature)

## Context

Annotation writes and projection reads were implemented by application-owned
Prisma access and a request-created service. Annotation anchors were also
defined beside the transport, which made the trace and annotation surfaces
reimplement their vocabulary.

## Decision

The singular `annotation` feature owns the portable annotation vocabulary,
anchor schemas, errors and one abstract `AnnotationService`. Its server
package owns one private repository and a PostgreSQL adapter. The service
supports annotation writes, tenant-scoped reads and the projection read used
by Trace. It validates inputs at the contract boundary and validates database
rows before returning them.

Existing tRPC and REST routes remain compatibility transports. They will be
migrated to the process-composed service in the application integration pass;
this package does not register routes or duplicate queue orchestration.

Annotation queues and score-definition management remain an explicit
application seam for now because their current router also owns trace
enrichment, membership authorization and queue-item workflows. They must be
drained into this same feature service rather than become separate features.

## Boundaries

The contract contains only transport-safe values and Zod 4 schemas. The server
repository is private and is the only owner of Annotation persistence. A
required lookup throws `AnnotationNotFoundError`; a repository absence check is
named `tryFindById` and is converted to the throwing service method.

The service accepts only its own repository. Trace, authorization and queue
composition are collaborators for later transport migration, not repository
ports recreated inside Annotation.

## Public surfaces and transports

The contract is the supported feature capability. Existing tRPC and REST
transports keep their URLs and response shapes while they are migrated to the
process-owned service. The feature package itself registers no routes.

## Dependencies

The contract has no application, transport, database or runtime dependencies.
The server depends on the contract and Prisma infrastructure only; its service
receives its own private repository.

## Persistence

`PrismaAnnotationRepository` is private to the server package and owns
Annotation rows. It parses every returned row with the contract schema before
returning it.

## Runtime and registration

The API or worker composition root constructs one `PostgresAnnotationAdapter`
and injects its resulting `AnnotationService` into handlers. Requests do not
construct services, repositories or database clients.

## Environment and configuration

The feature reads no environment values. Database construction and runtime
configuration are supplied by the application boot composition.

## Errors

Required reads throw `AnnotationNotFoundError`. Nullable persistence discovery
is named `tryFindById` and is private to the server implementation.

## Contracts and validation

All feature inputs and returned values use Zod 4 schemas from the contract
package. Generated Prisma records do not cross the server boundary.

## Consequences

Annotation has one discoverable capability and one persistence lifecycle while
the existing URLs and tRPC procedure names remain stable. Trace projections
can consume a portable annotation projection without importing Prisma or
application aliases. Queue and score migration remain visible as the next
annotation seam rather than being hidden in a partial duplicate implementation.
