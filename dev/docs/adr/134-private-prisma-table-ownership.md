# ADR-134: Private Prisma repositories claim tables for one feature

**Date:** 2026-09-07

**Status:** Accepted; migration in progress

**Behavioural contract:** [Prisma ownership](../../../specs/server/prisma-table-ownership.feature)

**Related:** [Composition](./133-composition-spec.md),
[singular feature ownership](./112-singular-feature-ownership.md),
[day-one inventory](../research/prisma-ownership/README.md).

## Context

Feature API boundaries do not isolate persistence while every repository can
receive the complete Prisma client. User, Project, Organization and AuditLog
have callers in many features. A private repository must not become another
feature's back door into those tables.

The inventory maps 125 Prisma models to proposed domain and framework owners.
It is migration evidence, not a second ownership authority. Feature identities
remain in `packages/features/catalogue.json`; executable table claims live on
the owning repositories.

## Decision

A private Prisma repository declares its model group once:

```ts
class PrismaAuditLogRepository {
  static readonly tables = prismaTables("AuditLog");
  // Private persistence implementation.
}

class AuditLogApp {
  static readonly repositories = { entries: PrismaAuditLogRepository };
  // Existing contract, dependencies and create(FeatureSetup) factory.
}

defineFeature("audit-log").withApp(AuditLogApp).build();
```

The App identifies its private repositories. The feature builder infers their
claims; it has no additional Prisma-specific `.withX` call or repeated table
list. App metadata remains server implementation detail. Peers receive only
`AuditLogApi`, never a repository or generated Prisma type.

`prismaTables` accepts a nonempty tuple of real Prisma model names, checked by
TypeScript. A generated catalogue resolves models to physical table names,
including `@@map`. Runtime validation rejects invalid untyped names. Claims
and the copies held by declarations are frozen.

Before constructing any feature, boot rejects two different feature owners of
the same store/table. This applies to API, worker and task roles. Multiple
repositories inside the same feature may share a coherent table group.
Architecture lint also checks explicit claims across the complete catalogue,
including owners that are never installed together. Claims must use literal
model names on the owning Prisma repository; computed lists and forwarded
claim factories are rejected.

These checks establish ownership declarations. They do not yet prove that
every declared repository is constructed or restrict the queries it executes.
Structural TypeScript assignability alone cannot provide that guarantee.

## Core owners

Webhook is a core feature owning `WebhookEndpoint` and
`WebhookEndpointDelivery`. Outbound delivery is shared capability used by
Automation and Enterprise entrypoints. Endpoint management retains its
existing entitlement and authorization policy; moving its implementation to
core does not grant access to paid product surfaces.

AuditLog is a core feature owning `AuditLog`. Recording and retrieving domain
history are shared capabilities, including Agent and Evaluator history.
Enterprise governance remains a consumer with its existing policy. Preserve
both existing audit row formats and legacy tenant-scoped history semantics.
The API audit hook uses the installed AuditLog App instead of constructing a
repository and service for each mutation.

## Isolation rollout

1. Introduce repository claims and boot/catalogue checks. AuditLog declares
   its repository through its App. Webhook's repository declares its group;
   its legacy App still needs canonical composition before boot collects it.
2. Give each repository a capability scoped to its declared models, with
   corresponding TypeScript types and runtime enforcement. Raw SQL,
   `$extends`, client internals and unrestricted transaction clients must not
   be escape hatches. Interactive transactions retain the same scope.
3. Migrate direct foreign callers to complete peer APIs. Enforce registration
   and scoped-client usage for adopted repositories; do not call metadata-only
   adoption isolation. Move Automation's remaining delivery implementation
   behind Webhook's API and migrate AuditLog's direct history readers/writers.
4. Require complete ownership coverage once framework storage and remaining
   feature groups have migrated. Do not invent feature owners for framework
   receipts, eventing infrastructure or migration bookkeeping.

Foreign relations need explicit treatment. A top-level delegate restriction
does not stop nested `include`, `select`, relation filters, nested writes or
Prisma-emulated cascades. The repository capability must reject those paths
unless an exact, reviewed migration exception permits them. An exception names
the repository, relation/operation, reason and removal condition. It does not
make a second owner or permit arbitrary access to the target table.

Keep coherent child tables together where they belong to the same feature.
Do not drop relations as part of this initial migration. The schema uses
Prisma 7's `relationMode = "prisma"`; removing a relation can remove integrity
and cascade behavior. Cross-feature transactional audit writes need a named
transaction-preserving seam before their current implementation is replaced.

## Consequences

The framework catches conflicting declarations before feature side effects.
The lint catches conflicts outside one process's graph and gives a local
repair instruction. Neither is tenant authorization: Feature APIs must still
preserve tenant predicates and validate resource ownership where applicable.

The first implementation assumes one Prisma datasource. Multi-schema support
must include schema identity before being enabled. No declaration may claim
that database-wide isolation is complete while unscoped clients, unregistered
repositories or foreign relation paths remain.
