# ADR-001: Stored Objects is a one-row feature over existing storage

**Date:** 2026-08-22

**Status:** Proposed

**Behavioural contract:**
[Stored Objects service and API](../specs/stored-objects.feature)

**Related:**
[ADR-101: feature package surfaces](../../../../dev/docs/adr/101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](../../../../dev/docs/adr/102-runtime-composition-roots.md),
[ADR-103: Standard Schema API boundary](../../../../dev/docs/adr/103-standard-schema-api-boundary.md),
[strict feature source layout](../../../architecture-lint/adrs/002-versioned-strict-feature-layout.md),
[RPC-first API registration](../../../api/adrs/101-rpc-first-fluent-registration.md),
[system migrations](../../../system-migrations/README.md),
[mandatory API authorization](../../../../specs/security/api-endpoint-authorization.feature),
and [ADR-040: durable stored-object offload](../../../../dev/docs/adr/040-durable-stored-object-offload-for-evaluation-inputs.md).

## Context

Stored Objects already stores content-addressed bytes through the application's
S3, Azure Blob and local-filesystem drivers. Metadata currently lives in the
mutable ClickHouse `stored_objects` table. It is small, keyed operational state,
so Postgres is a better long-term authority.

The feature needs a portable contract, a class-based service and store, a public
API, the existing application tRPC compatibility surface, byte delivery, and a
system migration from ClickHouse. It does not need a new storage platform or an
event-sourced workflow for every provider operation.

## Decision

Stored Objects lives in `packages/features/stored-objects` as two packages:

```text
packages/features/stored-objects/
├── contract/   # portable schemas, errors, RPC declarations and service contract
├── server/     # concrete store, service, migration and API registration
├── adrs/
└── specs/
```

There is no Stored Objects web package and no separate object-storage package.
The server package does not import the application. Application composition
adapts the storage implementation already present in
`platform/app/src/server/stored-objects`.

### Persistence

One Postgres row is the complete operational state; no parallel lifecycle or
projection persistence is part of this feature boundary.

Stored Objects adds exactly one domain table, `StoredObject`:

```text
StoredObject
  tenantId
  id
  status                       pending | available | deleted | failed
  purpose
  ownerKind
  ownerId
  filename
  storageProvider
  storageDestinationId
  storageProviderRelativeId
  sha256
  sizeBytes
  mediaType
  mediaTypeVerified
  generation
  audiences
  expiresAt
  availableAt
  deletedAt
  source
  legacyFingerprint
  createdAt
  updatedAt
```

`tenantId` is the project ID. `(tenantId, id)` is the primary key. Provider and
provider-relative identity replace a persisted delivery URL; the application
adapter resolves them through trusted configuration.

The row is primary operational state, not an event projection. Stored Objects
defines no lifecycle event family, replay cursor, operation table, audience
table, location table, idempotency table, process state, wake, claim, intent or
outbox. The generic system-migration tenant state remains owned by
`@langwatch/system-migrations`.

### Classes own behaviour

`StoredObjectStore` is the abstract class boundary for the table and
`PostgresStoredObjectStore` is its concrete class implementation.
`StoredObjectsService` is the concrete class that owns validation, content
identity, storage calls and state changes.
`ClickHouseImportStoredObjectMigration` is the concrete system-migration class.
API registration and the application storage adapter are classes as well.

There is no `StoredObjectProjection`, because there is no event fold to
project. Pure value helpers are allowed, but stores, projections when one
actually exists, and services are never object literals or free-function
factories.

### Dependencies

Stored Objects depends on its portable contract, the system-migration contract,
the unified API package, and narrow storage capabilities supplied by the app.
It does not depend on application source, provider SDKs, or Eventing.

#### Existing storage is reused

The application supplies one narrow `StoredObjectStorage` class backed by the
existing `StorageRegistry` and its S3, Azure Blob and local-filesystem drivers.
It supports only the operations Stored Objects needs: write, stat, read, delete
and an optional signed direct-upload target. It does not recreate provider
registries, destination resolution, locator formats or credentials.

Internal writes remain content addressed by authenticated project and SHA-256.
They write through the existing registry and then upsert an `available` row. If
the row write fails after new bytes were written, the service attempts
compensating deletion. Repeating the same verified write is safe.

For direct upload, the service persists a `pending` row with `expiresAt` before
returning a signed target for the final content-addressed location. Confirmation
checks the target's length and checksum and changes the same row to `available`.
A bounded cleanup pass finds expired `pending` rows, deletes their bytes and
marks them `failed`. No direct-upload target is offered when the selected
existing driver cannot support it.

Deletion first changes the row to `deleted`, immediately denying delivery, and
then attempts physical deletion. A bounded cleanup pass retries deleted rows
whose provider bytes remain. The same row retains the provider-relative
identity required for that retry.

These operations deliberately use ordinary database updates and idempotent
provider calls. This decision does not promise distributed exactly-once
execution or model provider timeouts as a new transaction system.

### Public surfaces and transports

The public surface registers four POST RPC operations through `@langwatch/api`:

```text
storedObjects.createUpload
storedObjects.confirmUpload
storedObjects.get
storedObjects.delete
```

The contract package supplies their Standard Schema inputs, outputs and handled
errors. The API package supplies routing, validation, OpenAPI, telemetry, error
mapping, authorization registration and rate limiting. Stored Objects declares
permissions and `.withRateLimit()`; it does not introduce a separate rate-plan
framework.

The application keeps tRPC separate. Its existing Stored Objects compatibility
procedure delegates to the same composed service rather than constructing
another one. GET/HEAD byte delivery remains a streaming data-plane route and is
not forced into RPC.

Project identity comes from authenticated context. Public create and confirm
require `project:update`, get requires `project:view`, and delete requires
`project:manage`. Stored Objects does not persist a second audience-grant model;
feature-specific authorization remains with the feature resolving the object.

### Contracts and validation

The contract package owns portable Zod 4 schemas, commands, results, concrete
errors, and the abstract service capability. REST or RPC registration consumes
those schemas through Standard Schema; tRPC compatibility remains an app-owned
adapter over the same service.

### Errors

The service throws concrete errors for absence, unavailable bytes, integrity
failure, expiry, and unsupported direct upload. The API boundary maps only
declared handled errors and does not expose provider or persistence details.

### Runtime and registration

App and worker composition roots construct the storage adapter, store, service,
API class, and system migration explicitly. Existing scheduled work invokes the
service's bounded cleanup methods; cleanup does not need another feature
service. Package imports have no registration side effects and create no
alternate application container.

#### ClickHouse migration

`ClickHouseImportStoredObjectMigration` implements the existing
`SystemMigration` contract. For each organization it pages projects, pages
their latest legacy ClickHouse rows, validates bounded scalar values, parses the
existing storage URI through the application adapter, and directly upserts the
Postgres row while preserving the object ID and byte location.

The import is idempotent. A row already represented by equal or newer Postgres
state is unchanged. Invalid input parks the tenant with a bounded report; it
does not create an event or a second quarantine store.

The rollout is intentionally simple. Existing ClickHouse-backed behaviour stays
authoritative while the migration runs. Old writers are drained, a final pass
proves every latest legacy row is represented in Postgres, and only then is the
Postgres-backed service enabled for that tenant. That finalization requires
operator confirmation. The migration remains inactive on self-hosted installs
until the cloud rollout has soaked and a later release explicitly enables it.
Supporting indefinite
mixed-version writes or automatic bidirectional reconciliation is out of scope.

### Environment and configuration

Stored Objects reads no environment variables. Runtime composition supplies
validated storage selection, upload expiry, cleanup batch size, and API rate
limits as narrow typed configuration.

## Alternatives considered

An event-sourced lifecycle with separate write, object and project process
managers was rejected because the operational state and recovery needs fit in
the one row. A new neutral object-storage package was rejected because the
application already has the required registry, drivers and destination logic.
Keeping ClickHouse as the permanent keyed read authority was rejected because
this is operational rather than analytical state.

## Consequences

- Stored Objects has one table, one store, one service and one migration class.
- Existing provider code remains the only provider implementation.
- Postgres becomes ordinary read and lifecycle authority after migration.
- ClickHouse migration requires an explicit old-writer drain before cutover.
- Pending upload and deletion cleanup are bounded scans of the same table.
- The design accepts ordinary retry and compensation rather than distributed
  exactly-once guarantees.
- Trace extraction, evaluation offload, rendering, provider migration,
  deployment and project-deletion policy remain with their existing owners.
