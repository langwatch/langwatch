# Strict feature layout and reduced Stored Objects plan

**Status:** Implemented, 2026-08-23
**Architecture:**
[`packages/features/stored-object/adrs/001-package-boundary.md`](../../../packages/features/stored-object/adrs/001-package-boundary.md)
**Behaviour:**
[`packages/features/stored-object/specs/stored-objects.feature`](../../../packages/features/stored-object/specs/stored-objects.feature)
**Migration substrate:**
[`@langwatch/system-migrations`](../../../packages/system-migrations/README.md)

## Outcome

Feature packages have one initial enforced format, `layoutVersion: 0`, described
in `packages/features/README.md` and checked by architecture lint. Agents,
Entitlements and Stored Objects use that format and their contract schemas use
Zod 4. `@langwatch/api` consumes schemas through Standard Schema so application
and feature routes share validation without coupling contracts to Hono.

Stored Objects lives entirely under `packages/features/stored-object` and has:

- one portable contract package;
- one server package;
- one Postgres `StoredObject` table;
- one abstract `StoredObjectStore` class and one concrete Postgres adapter;
- one concrete `StoredObjectsService` lifecycle class;
- one concrete `ClickHouseImportStoredObjectMigration` class; and
- thin public and internal API classes.

There is no Stored Object event family, projection, process manager, separate
object-storage package, alternate application container or custom rate-plan
framework. The existing application storage service and provider drivers remain
in place; composing and cutting over the reduced feature is a later rollout.

## Non-goals

- Replacing the application's S3, Azure Blob or local-filesystem drivers.
- Introducing a provider-neutral storage platform for other features.
- Event-sourcing Stored Object lifecycle changes.
- Distributed exactly-once provider operations.
- Provider relocation or migration policy.
- Reference counting, audience grants or restoration generations.
- Moving raw byte bodies through JSON RPC.
- Replacing application tRPC.
- Supporting indefinite mixed-version Stored Objects writers during cutover.
- Replacing the existing application service before the package foundation is
  deployed and its system migration is registered.

## Package shape

```text
packages/features/stored-object/
├── contract/
│   └── src/
│       ├── stored-object.service.ts
│       ├── stored-object.commands.ts
│       ├── stored-object.queries.ts
│       ├── stored-object.errors.ts
│       ├── ids.ts
│       ├── metadata.ts
│       ├── audiences.ts
│       ├── references.ts
│       ├── uploads.ts
│       ├── validation.ts
│       └── index.ts
├── server/
│   └── src/
│       ├── services/stored-object.service.ts
│       ├── stores/stored-object.store.ts
│       ├── stores/postgres/postgres.stored-object.store.ts
│       ├── ports/stored-object.port.ts
│       ├── api/public/stored-object.api.ts
│       ├── api/internal/stored-object.api.ts
│       ├── migrations/clickhouse-import.stored-object.migration.ts
│       └── index.ts
├── adrs/
└── specs/
```

## Persistent model

The Prisma model contains only operational facts:

```text
StoredObject
  tenantId                       project ID
  id                             content-addressed object ID
  status                         pending | available | deleted | failed
  purpose, ownerKind, ownerId    provenance
  filename                       presentation name
  storageProvider                s3 | azure-blob | file
  storageDestinationId           configured destination
  storageProviderRelativeId      trusted provider-relative address
  sha256, sizeBytes, mediaType   byte facts
  mediaTypeVerified              verification state
  generation, audiences          delivery fencing and allowed use
  expiresAt                      pending-upload cleanup deadline
  availableAt, deletedAt
  source, legacyFingerprint      idempotent ClickHouse import
  createdAt, updatedAt
```

Primary key: `(tenantId, id)`.

No other Stored Objects table is added. The row remains after logical deletion
so delivery stays revoked and cleanup can retry using its provider-relative
identity.

## Service behaviour

### Internal writes

1. Validate metadata and compute SHA-256.
2. Derive the existing project-scoped content ID.
3. Write through the existing `StorageRegistry` adapter.
4. Upsert the row as `available`.
5. If the row write fails after a new byte write, attempt compensating delete.
6. Treat a repeated write of identical verified bytes as success.

### Direct upload

1. Validate authentication, permission, rate limit and bounded metadata.
2. Derive the content ID and final content-addressed provider location.
3. Ask the existing storage path for a signed target; unsupported drivers
   return the handled unavailable error.
4. Persist the row as `pending` with `expiresAt` before returning the target;
   compensate the provider allocation if persistence fails.
5. Confirmation verifies provider length and SHA-256, then marks the row
   `available`.
6. A bounded cleanup call deletes expired pending bytes and marks the row
   `failed`.

No staging promotion protocol or separate write operation exists.

### Read and delivery

1. Read the project-scoped row from Postgres.
2. Refuse non-available rows.
3. Resolve the provider-relative identity through trusted application
   configuration.
4. Stream through the existing driver.
5. Preserve safe media headers and non-disclosing errors.

### Delete

1. Mark the row `deleted`.
2. Refuse all later delivery immediately.
3. Attempt provider deletion.
4. Leave the row available to bounded cleanup when physical deletion fails.

Repeated deletion and cleanup are idempotent.

## API shape

The public installer registers these POST RPCs through `@langwatch/api`:

| RPC                           | Permission       |
| ----------------------------- | ---------------- |
| `storedObjects.createUpload`  | `project:update` |
| `storedObjects.confirmUpload` | `project:update` |
| `storedObjects.get`           | `project:view`   |
| `storedObjects.delete`        | `project:manage` |

Their definition chains declare Standard Schema input/output, handled errors,
OpenAPI metadata and `.withRateLimit()`. The API package supplies routing,
validation, authorization registration, telemetry and error mapping.

GET/HEAD delivery remains a streaming route. The existing dashboard tRPC
procedure delegates to `app.storedObjects`; no new parallel tRPC product API is
added.

## ClickHouse system migration

`ClickHouseImportStoredObjectMigration` implements the existing system
migration contract.

For each organization:

1. Page its projects in stable order.
2. Page each project's latest `stored_objects` rows by ID.
3. Validate bounded fields and project ownership.
4. Parse `storage_uri` with the existing application storage code.
5. Upsert an `available` Postgres row preserving ID, owner, purpose, byte facts
   and storage location.
6. Skip equal or newer Postgres state.
7. Return a bounded failure report and park the tenant when a row is invalid.
8. After old writers drain, run a final parity pass and finalize only when every
   latest legacy row exists in Postgres.

Until finalization, the existing ClickHouse service remains authoritative for
that tenant. Enabling the Postgres service is the contract step. There is no
event import, replay projection, continuous reconciler or second quarantine
store.

## Implemented sequence

### 1. Establish and enforce layout version 0

- Add the feature README, canonical artifact grammar and responsibility rules.
- Reject every layout version other than 0; there is no legacy allowlist.
- Enforce package roles, dependency direction, file names, class-shaped
  services/stores/APIs/migrations, `static create`, Prisma containment,
  environment isolation, explicit exports and portable declarations.
- Require Zod 4 in every feature contract manifest and reject Zod 3 feature
  imports.

### 2. Migrate reference features

- Move Agents to `layoutVersion: 0` and Zod 4 without changing its contract.
- Move Entitlements to `layoutVersion: 0`, add its abstract contract service,
  and place the concrete service under `server/src/services`.
- Make the API framework accept Standard Schema rather than a Zod-major type.

### 3. Remove speculative Stored Objects infrastructure

- Delete `packages/object-storage` and its workspace dependencies.
- Remove Stored Objects event contracts, lifecycle processes, signals, wakes,
  intents, projections and worker registration.
- Remove capability-codec layering, custom rate-plan classes and unavailable
  service boilerplate.
- Do not add another provider registry or storage abstraction package.

### 4. Reduce the contract and Prisma model

- Keep IDs, metadata, upload schemas, public RPC declarations, service contract
  and handled errors.
- Remove lifecycle events and process-manager contracts.
- Keep audience and generation only as fields on the one operational row.
- Reduce the Prisma model and SQL migration to the fields in this plan.

### 5. Implement the store and service

- Make `StoredObjectStore` an abstract class and
  `PostgresStoredObjectStore` its only concrete table adapter.
- Make `StoredObjectsService` the only lifecycle service class.
- Cover internal write, direct upload, confirmation, read, delete and cleanup.

### 6. Implement the system migration and package APIs

- Implement the direct ClickHouse reader-to-Postgres upsert class.
- Cover paging, retry, invalid rows, old-writer drain and final parity.
- Define the four public RPCs through `@langwatch/api`, including permissions,
  OpenAPI metadata and the existing rate-limit capability.
- Keep runtime composition, streaming delivery, tRPC delegation and migration
  registration out of this package-only change.

## Verification

- The feature spec contains 13 focused scenarios and no duplicated platform
  behaviour.
- Prisma contains exactly one Stored Objects domain table.
- Store boundaries, service, APIs and migration are classes.
- No Stored Objects source imports Eventing or a new object-storage package.
- Contract declarations contain no Prisma, ClickHouse, provider SDK or Node
  stream type.
- Store/service tests cover idempotent writes, confirmation and retryable
  deletion from the same row.
- Migration tests cover direct import, reruns and writer-drain finalization.
- Architecture lint, API, Agents, Entitlements and Stored Objects typechecks and
  focused tests pass.
- Application typecheck has no new Zod-major or Stored Objects integration
  errors; unrelated shared-worktree failures are reported separately.
