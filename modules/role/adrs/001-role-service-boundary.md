# ADR-001: Custom roles have one service boundary

**Status:** Accepted

**Behavioural contract:** [Role service](../specs/role-service.feature)

## Context

Custom-role validation, assignment and deletion were repeated in Role, API Key,
Invite and Team callers. AuthZ owns grant facts and permission decisions, but a
grant store is not the product API for defining and managing custom roles.

## Decision

`RoleService` is the only cross-feature capability for custom-role definitions
and assignment policy. It owns reserved names, organization tenancy,
assignability, organization-exclusive permission scope, holder checks, and
safe deletion. It delegates durable binding and role facts to AuthZ through the
private server implementation.

AuthZ continues to own permission decisions, bindings and grant persistence.
Callers use Role for custom-role behaviour and AuthZ for authorization; they do
not import either feature's repository.

The contract uses Zod 4 and portable values. The server root exports the
Postgres adapter and its construction ports only. One Role service is composed
for the process and reaches Hono and tRPC through the App graph.

### Public surfaces and transports

The contract exports portable role values, errors, and the one abstract
`RoleService`. Existing REST and tRPC URLs remain compatibility transports and
delegate to the service on App context.

### Dependencies

The server implementation receives canonical AuthZ services and its own
private repository. Scope and permission policy are narrow construction ports;
feature callers depend only on `@langwatch/role-contract`.

### Persistence

Custom-role and compatibility binding reads are owned by the private Prisma
repository under `repositories/prisma`. Durable role and grant writes go
through AuthZ commands.

### Runtime and registration

Boot constructs one Role service for the process. Hono uses
`c.var.langwatchApp.roles`, tRPC uses `ctx.app.roles`, and no request constructs
a Role repository or service.

### Environment and configuration

Role packages read no environment values. Boot injects identity generation and
scope policy when it creates the PostgreSQL adapter.

### Errors

Required reads and mutations throw Role-owned errors. A nullable result exists
only for the used `tryGet` and `tryGetUserBinding` capabilities; repository
methods follow the same naming rule.

### Contracts and validation

Cross-feature and transport values use Zod 4 schemas from the contract root.
The contract contains no Prisma, Node, transport, environment, or application
imports.

## Consequences

API Key, Organization and Invite can share one definition of an assignable
custom role. Existing Role REST and tRPC names remain compatibility transports.
The legacy Role service, repository, and characterization tests have been
removed; the package server tests exercise the canonical service boundary.

## Amendment (2026-09-08): the annotation shape

The boundary above stands; where it lands has moved to the shape ADR-133
describes, and the names in this document are read as history.

- `RoleApi` replaces the abstract `RoleService`. The callable operations are
  the same behaviour; a caller arrives as an argument.
- `RoleApp` is the one application. It owns the peer calls the services and the
  Postgres adapter used to make: authorization (`AuthzApi`), the team directory
  (`OrganizationApi`) and the caller's display identity (`UserApi`).
- The Postgres adapter is gone. `RoleRepository` reads `CustomRole` and counts
  `TeamUser` assignments, with a Prisma backend and a memory twin chosen at
  boot by `defineRepositories`.
- Every tRPC procedure is declared once in the contract and bound in
  `transport/role.trpc.ts` and `transport/role-binding.trpc.ts`; REST is
  `transport/role.rest.ts`. Names, paths, schemas and versions are unchanged.
- Three ports remain, all technical: the personal-workspace fence, the
  Enterprise plan gate and the binding identifier format. Each is supplied by
  the process that composes the ledger, the plan and the workspace rows.
- `getById`, `update` and `delete` resolve the role's organization and run the
  authorization check in the application, because no request names it. Their
  procedures declare `serviceAuthorized` with the permission each enforces.
