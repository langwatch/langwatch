# ADR-001: One Organization service boundary

**Status:** Accepted

**Behavioural contract:** [Organization service](../specs/organization-service.feature)

## Context

Organization, team, and group behavior was repeated by caller-owned Prisma
repositories. The Teams REST API also constructed a service and repository for
every request. Both Group transports did the same and mixed Group persistence
with AuthZ, Team, Project, and Organization queries.

## Decision

Organization and team lifecycle behaviour is exposed by one portable
`OrganizationService`. Features receive the process-owned service through
composition and do not query Organization or Team persistence themselves.

`getOldestTeamId` returns a team identifier or throws the Organization-owned
error. A future optional lookup would use a `try*` name, but no optional form is
defined until a real caller needs it.

Team lifecycle is part of this same service. `getTeam`, `listTeams`,
`createTeam`, `updateTeam`, `archiveTeam`, `addTeamMember`, and
`removeTeamMember` preserve the existing `/api/teams` behavior. The private
Team repository owns Team and OrganizationUser persistence. Membership writes
go through the injected AuthZ grants service, and project listing goes through
the Project service at the API composition boundary. Personal teams cannot be
archived or have their membership changed.

The richer Team compatibility API follows the same boundary. Team membership
is read from AuthZ bindings, not `TeamUser`. Duplicate bindings collapse by
role priority for presentation, emails are hidden from callers who cannot
manage the team, and a slug lookup by a non-member throws the same Team error
as a missing team. Membership edits preserve unrelated additive grants and
cannot leave a shared team without an effective administrator, including an
administrator inherited through a group. Writes attach replacement access
before changing it and revoke removed access last; a repository revision fence
rejects a stale edit before durable grant commands are emitted.

Group lifecycle is also subordinate to Organization. Group persistence is
limited to Group and GroupMembership rows; membership eligibility and personal
team checks use the Organization-owned Team repository, while all bindings,
role reads, and scope resolution use the injected AuthZ services. Hono and
tRPC preserve their existing URLs and response shapes but do not construct a
Group service or repository.

The contract uses Zod 4 and contains no persistence, transport, environment, or
application imports. The server implementation owns its private repositories.

### Public surfaces and transports

The contract package exports portable Organization values, errors, and the
single abstract `OrganizationService`. Existing REST and tRPC routes remain
compatibility transports and delegate to the composed service.

### Dependencies

Other features depend only on `@langwatch/organization-contract`. The server
implementation may depend on narrow feature contracts and private ports; it
does not import application source.

### Persistence

Organization, Team, Group, and GroupMembership persistence belongs to the
private Prisma repositories in the Organization server package. Other strict
features do not query those models directly.

### Runtime and registration

Each API or worker process constructs one Organization service. Hono receives
it through `c.var.langwatchApp`, tRPC through `ctx.app`, and feature services
receive the same instance through constructor composition.

### Environment and configuration

Organization packages read no environment values at module import. Boot code
validates configuration and injects infrastructure before creating the service.

### Errors

Ordinary lookups throw Organization-owned domain errors. Only deliberately
optional `try*` methods may expose absence, so callers neither inspect
persistence errors nor repeat absence checks.

### Contracts and validation

Cross-feature and transport inputs use Zod 4 schemas from the contract root.
The contract contains no Prisma, Node, transport, or application imports.

## Consequences

Organization invariants have one implementation. Project and other features
depend only on `@langwatch/organization-contract`. Team and Group requests reuse
the process-owned service. Their displaced request middleware and legacy
services and repositories are removed.
