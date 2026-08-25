# ADR-001: Annotation has one service boundary

**Status:** Accepted

**Behavioural contract:** [Annotation service](../specs/annotation-service.feature)

## Context

Annotation writes and projection reads originated in application-owned Prisma
access and request-created services. Anchor vocabulary was defined beside the
transports, so trace and annotation surfaces could drift.

## Decision

The singular `annotation` feature owns the portable annotation vocabulary,
anchor schemas, errors and one abstract `AnnotationService`. Its server package
owns one private repository and a PostgreSQL adapter. The service owns writes,
tenant-scoped reads, projection reads, score definitions, queue-item creation
and queue-reference validation. Inputs and returned database rows are parsed by
the contract schemas.

Existing tRPC and REST routes remain compatibility transports; this package
does not register routes. Browser routing, transport hooks, draft stores and
trace navigation stay in the application and are passed to annotation web
components through narrow props and callbacks. The web package owns controlled
cards, chips, avatars, form bodies, diffs and score fields. The generic delete
confirmation remains shared application UI because dataset and prompt surfaces
also use it.

The queue router still owns trace enrichment, membership authorization and
queue configuration and read workflows. Transport-specific user enrichment
also remains there. These are deliberate residuals until that orchestration has
its own complete migration slice.

## Boundaries

The contract contains transport-safe values and Zod 4 schemas. The server
repository is private and is the only owner of Annotation persistence. A
required lookup throws a concrete domain error from both the service and its
repository. Neither boundary returns a nullable value for a required record.

The concrete service receives its private repository, the complete
`ProjectService` and the complete `OrganizationService`. Project ownership and
organization membership stay behind their owning services; Annotation maps only
the project absence and invalid-member outcomes required by its existing 404
and 400 transports.

The tRPC transport hydrates users in one `UserService` batch per result set.
The repository does not query User. Full legacy user fields remain on project
and queue results, trace results keep id, name and image, and ordinary
annotation values remain user-free.

## Persistence

`PrismaAnnotationRepository` is private to the server package and owns only
Annotation, score, queue and queue-item rows. It parses every returned row.
Queue-item upserts share one transaction while retaining their existing unique
keys and reset-on-requeue behaviour.

The process composition root builds one annotation service for each process
preset and injects it into handlers. Requests do not construct it. The feature
reads no environment values, and generated Prisma records do not cross the
server boundary.

## Consequences

Annotation has one discoverable capability, one reusable browser surface and
one persistence lifecycle while existing URLs and tRPC procedure names remain
stable. Trace projections can consume a portable annotation projection without
importing Prisma or application aliases. The remaining application query and
mutation composition, queue configuration/read seam, stores and startup hook
are explicit process responsibilities, not a second Annotation implementation.
