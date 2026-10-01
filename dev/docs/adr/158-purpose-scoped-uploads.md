# ADR-158: Purpose-scoped uploads: a file is uploaded to a signed URL, confirmed, and attached by reference

**Date:** 2026-09-24

**Status:** Accepted (Alex, 2026-09-24); §3, §5, §8 and §10 revised the same day ("Keep purpose read checks"); §8, §9 and §10 amended the same day: `/attachments` kept deprecated, the web-only `/direct-upload*` routes removed

**Relates to:** [ADR-155](./155-migrations-are-never-breaking.md) (every schema and wire step below is expand-then-contract),
[stored-object ADR-001](../../../modules/stored-object/adrs/001-package-boundary.md) (one Postgres row is an object's whole state),
`dev/docs/ARCHITECTURE.md` §3.2, §3.3, §6, §7, §8.

**Behavioural contract:** [purpose-scoped-upload.feature](../../../modules/stored-object/specs/purpose-scoped-upload.feature),
[dataset-attachments.feature](../../../specs/datasets/dataset-attachments.feature).

## Context

Alex, 2026-09-24:

- "we shouldn't ever really accept bytes".
- "build our own presigned upload path for local file storage, with streaming on upload, this means our
  apis stay simple, and our system never parses what should be streamed".
- "upload storage file with a purpose, then attach the uploaded and confirmed file with the correct
  purpose and acceptable filetype to the dataset create or update method".
- "users can't know about the different upload backend, we need a signed url generated users can put to
  like normal".
- "you can stream data to hash it"; "Hash on confirm".
- "purpose is on the document.... id is ALWAYS a ksuid".
- "permission would not matter, MAYBE permissions should be mapped to a scope".

The dataset import (CSV, JSON, JSONL, bulk) takes the same shape. All of it has to work end to end
before the merge commits.

What the branch holds today:

1. **Dataset owns object storage it cannot reach.** `{s3,azure,local}.dataset-storage.service.ts`
   store chunk content and also run upload staging. Nothing composes them:
   `apps/api/src/main.ts:52` and `apps/worker/src/main.ts:47` supply `storageResolver: () => void 0`.
   So importing a dataset does not work at HEAD.
2. **Attachments have no path.** `POST /api/dataset/attachments` answers 410 (`dataset.rest.ts:237`).
3. **Stored-object's upload is half-built.**
   - Every upload row is stamped `public_upload` (`stored-object-upload.service.ts:337`).
   - The token codec and delivery are `Unavailable*` classes.
   - No driver can presign.
   - `createUpload` answers a root union, which REST cannot declare.
4. **An object's id is derived from its content.** `deriveStoredObjectId` builds a fixed KSUID from
   `sha1(projectId:sha256)` (`stored-objects.service.ts:28`). As a result, one object, and so one
   purpose, is shared by every writer of the same bytes.
5. **There are two indexes, so an upload cannot be read back.** Writes go to Postgres `StoredObject`
   rows, but `/api/files` reads the ClickHouse `stored_objects` index. The migration from ClickHouse,
   `stored-objects-clickhouse-import-v0`, exists but nothing registers it.
6. **Stored-object depends on dataset.** Stored-object imports `@langwatch/dataset-contract` to map a
   purpose to a permission (`stored-object-purpose-permission.rules.ts`).
7. **Storage drivers exist twice.** Released dataset chunks sit at raw keys from `chunkKey`, and
   stored-object composes its own S3, Azure and filesystem drivers.
   process-stores already defines an `objectStorage` member, but it is S3-only, holds whole bodies in
   memory, and no app composes it (`packages/process-stores/src/object-storage-member.ts`).

## Decision

### 1. Object storage is a store the process supplies

The existing `objectStorage` member (`ProcessMembers.objectStorage`, supply kind `blobs`) becomes the
only object store.

- It covers S3, Azure Blob and the local filesystem, and routes per project inside the client, as §7
  rules for ClickHouse.
- It has a memory twin.
- Every body is a stream, and every digest is taken over a stream:

  ```ts
  interface ObjectStorage {
    write(
      at,
      body: AsyncIterable<Uint8Array>,
      facts: { byteLength; contentType },
    ): Promise<{ byteLength; sha256 }>; // counts and hashes while writing; refuses past byteLength
    read(at): Promise<AsyncIterable<Uint8Array>>;
    digest(at): Promise<{ byteLength; sha256 }>; // the backend's SHA-256 where it holds one,
    // otherwise the object streamed back through the hash
    remove(at): Promise<void>;
    signUpload(
      at,
      facts: { byteLength; contentType; expiresAt },
    ): Promise<{ kind: "direct"; url; headers } | { kind: "through-process" }>;
    destination(projectId);
    probe(projectId);
  }
  ```

- Addresses are today's `{ projectId, key }`.
- Stored-object's S3 targets, destination policy, drivers and Azure credentials move into the member.
- The storage settings move from `storedObjectConfig` to the stores owner under the same environment
  names, together with the secrets `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SESSION_TOKEN` and
  `AZURE_BLOB_ACCOUNT_KEY`.
- Stored-object builds its blob repository over the member, and dataset builds its chunk repository
  over it. Main's released chunk keys therefore stay where they are.

### 2. Who owns what

- **stored-object** owns _a stored file with a purpose_: the record, create, the signed PUT, confirm,
  reading the file back (`/api/files`), and the purpose table.
- **dataset** owns rows, cell values, references and its chunk content.
  - It never receives an upload body; the one exception is time-boxed (§8).
  - The worker's normalisation reads a confirmed import file as a stream from
    `StoredObjectApi.getById` and parses it row by row, never from a request body.

### 3. Identity and purpose

- **Every stored object's id is a fresh KSUID**: `generate("so")` from `@langwatch/ksuid`, precedent
  `agent.app.ts:460`. An id is never derived from `projectId`, purpose, digest or any content. This
  covers uploads and in-process writes (`storeFromBytes`) alike.
- **Purpose is a field on the record**, set once at create and never changed.
- A new object's bytes live at `{projectId}/{id}`. Objects are never shared by content, and there is no
  byte-level dedup. Each upload and each `storeFromBytes` call is its own object.
- The record keeps `sha256` and `byteLength` as facts measured at confirm or write, not as identity.
- Existing objects keep their ids and keys.
- **The purpose table.** `modules/stored-object/contract/src/stored-object-purposes.ts` holds
  `STORED_OBJECT_PURPOSES`. It records, per purpose, whether a caller may upload it, its byte limit,
  and the permission its files are read behind (§5). Uploading needs no purpose permission.

  | purpose                                                    | uploadable | max bytes | read permission  |
  | ---------------------------------------------------------- | ---------- | --------- | ---------------- |
  | `dataset_attachment`                                       | yes        | 20 MiB    | `datasets:view`  |
  | `dataset_import`                                           | yes        | 5 GiB     | `datasets:view`  |
  | `trace_content`                                            | no         | 100 MiB   | `traces:view`    |
  | `scenario_event`, `evaluation_inputs`, every other purpose | no         | 100 MiB   | `scenarios:view` |

- The effective upload limit is the smaller of the purpose's limit and the backend's single-PUT
  maximum. Azure Put Blob tops out at 5000 MiB, so a `dataset_import` on Azure is capped there.

- `public_upload` is retired. `DATASET_ATTACHMENT_PURPOSE` moves here, and the dataset contract imports
  it from stored-object.
- `REFUSED_ATTACHMENT_MEDIA_TYPES` (HTML, SVG, scripts) moves into stored-object's
  `safe-media-types.ts`. Files are served from our origin, so a type a browser can run is refused at
  create for every purpose a caller may upload.
- Which file types a _consumer_ accepts belongs to the consumer, and is checked at attach time (§6).

### 4. Uploading: create, PUT to a signed URL, confirm. The same on every backend

```ts
createUpload(input: { projectId; purpose; filename; mediaType; byteLength })
  : Promise<{ objectId; uploadUrl; method: "PUT"; headers?: Record<string, string>; expiresAt }>
confirmUpload(input: { projectId; objectId }): Promise<StoredObjectReference>
```

- **The client's flow.** The client PUTs the bytes to `uploadUrl` with `headers`, then confirms. It
  learns no backend, holds no token, and computes no hash.
- **`createUpload`** refuses, by name, three cases:
  - a purpose a caller may not upload;
  - a file over the purpose's limit;
  - a media type a browser can run.

  The first and third are `validation_error` (422) with `meta.fieldErrors.purpose` or
  `meta.fieldErrors.mediaType`; an oversized file is `upload_too_large` (413) naming the limit.
  Otherwise it mints the KSUID, writes the `pending` record with its purpose, and asks
  `objectStorage.signUpload` for the URL.

- **Where the URL points:**
  - **S3:** a presigned PUT whose signature covers `content-type` and `content-length`.
  - **Azure:** a SAS URL, from a user-delegation key under workload identity or from the account key.
  - **Local filesystem** (`through-process`): a URL stored-object signs itself,
    `{publicBaseUrl}/api/stored-objects/uploads/{objectId}/content?sig=…`.
    - The claims inside `sig` are project, object, byte length, media type and expiry.
    - They are sealed by the process's `encryption` member, AES-256-GCM, whose seal is its own
      signature. Precedent: `hosted-mcp.app.ts:45`. No new secret is needed.
- **The local signed route.** `PUT /api/stored-objects/uploads/:storedObjectId/content` is hidden from
  the docs, and clients only ever receive it as an `uploadUrl`.
  - Access is public, with the stated reason "signed URL". The body is read with
    `withRawBody("stream")`, precedent `dataset.rest.ts:196`.
  - It calls the internal operation `writeUpload`, which:
    - refuses an altered, foreign or expired signature before it reads the body;
    - streams the body into `objectStorage.write`, which lands on disk while counting and hashing;
    - stops at `byteLength + 1` (413) and leaves no partial file. There is no earlier 413 from
      `Content-Length`: the REST handler sees no request headers, and nothing past the cap is kept.

  **This is the one standing place the server accepts upload bytes.**

- **`confirmUpload` hashes on confirm.**
  - It reads `objectStorage.digest`: the backend's own SHA-256 where it holds one (the digest the local
    write computed), otherwise the object streamed back through the hash (S3 and Azure uploads).
  - The stored size must equal the declared `byteLength`.
  - It records `sha256` and moves the record to `available`.
  - It is idempotent.
  - Pending records expire after 15 minutes and are reaped from the same record.
- **Uploading is authorised by the request's ordinary project scope.** No upload check depends on the
  purpose; reading one back does (§5).
  - Browser (tRPC, in `stored-object.trpc.ts`): `storedObjects.createUpload` and
    `storedObjects.confirmUpload`.
  - API key (REST, the `stored-objects` family at 2026-08-22): `POST /uploads` and
    `POST /uploads/:storedObjectId/confirmation`. The confirmation route replaces
    `POST /:uploadToken/confirmation`, which never shipped on main.
  - All four declare `withPermission("project:update")`, the existing precedent at
    `stored-object.rest.ts:27`.
- **`storeFromBytes`** mints a KSUID, streams the bytes through `objectStorage.write`, and records the
  digest the write returns. It never hashes a buffer and never deduplicates, so `isDuplicate` is always
  `false`.

### 5. One index

- The Postgres `StoredObject` row is the only index, as stored-object ADR-001 proposes.
- `readById`, `headById`, `getMetadata` and `getById` read the Postgres row first. When there is none,
  the ClickHouse index answers, read-only, until `stored-objects-clickhouse-import-v0` completes. That
  migration is registered as a task in `apps/tasks`. Nothing writes ClickHouse.
- One release after the import completes, the ClickHouse read and `StoredObjectsService` are deleted
  (ADR-155 contract).
- `/api/files` streams from `objectStorage.read`.
- `/api/files` and `storedObjects.headById` keep main's two-step read check: before the record is
  read, any of `traces:view`, `scenarios:view` or `datasets:view`; after it, the one permission the
  record's purpose names in the purpose table (§3). A dataset-only viewer reads dataset files and
  nothing else.

### 6. Attaching to a dataset: references in, never bytes

- **The cell value stays main's string**, `/api/files/<projectId>/<objectId>/<filename>`. The pure
  function `datasetAttachmentRefOf(reference)` in `dataset-attachment-ref.ts` builds it.
- **`upsertDataset` (with records), `batchCreateRecords` and `upsertRecord` check references.** Each
  image or file cell holding a stored reference the record did not already hold is checked through the
  new peer `storedObjects: StoredObjectApi` (`getMetadata`). The file must:
  - be in the dataset's project;
  - be confirmed;
  - have the purpose `dataset_attachment` on its record;
  - be within `DATASET_ATTACHMENT_MAX_BYTES`;
  - have a media type the column accepts: `image/*` for image columns, anything not blocked for file
    columns.

  The pure rule `datasetAttachmentAcceptance({ columnType, purpose, mediaType, byteLength })` sits in
  the dataset contract and is shared with the browser. URLs and data URLs pass as they do today.

- **Refusals:**
  - a wrong media type is the existing 415 `dataset_attachment_type_refused`;
  - a file over the limit is the existing 413 `dataset_attachment_too_large`;
  - not found, not confirmed, another project or the wrong purpose is the new code
    `dataset_attachment_reference_refused` (422, with `meta.reason` and `meta.column`).
- **Import:**
  - `createDatasetFromStoredObject({ projectId, name, storedObjectId, columnTypes? })` answers
    `{ datasetId, slug, status: "processing" }`.
    - It checks the purpose `dataset_import`, that the file is confirmed and in the same project, and
      that its name ends `.csv`, `.json` or `.jsonl`.
    - It records the source in a new nullable `Dataset.sourceStoredObjectId` and queues normalisation.
    - `retryNormalize` reads the same file again.
  - `appendStoredObjectToDataset({ projectId, slugOrId, storedObjectId })` answers
    `{ datasetId, recordsCreated }`. It is synchronous, capped at `MAX_FILE_SIZE_BYTES` as main's
    append was, and streams the file from storage.
  - Both are declared on the dataset tRPC contract and as REST routes: `POST /api/dataset/imports` and
    `POST /api/dataset/:slugOrId/imports`. These routes are new and additive.

### 7. Configuration

- The storage settings are the stores owner's (§1), and apps compose them with the other stores.
- Stored-object declares nothing new. The local URL's origin comes from the `publicBaseUrl` member
  (precedent `dataset.app.ts:128`). The limits and the 15-minute TTL are constants.
- There is no supply token: object storage is a store.
- Both `.withMember("storageResolver", () => void 0)` lines are deleted.

### 8. Wire compared with main, and the time-boxed exception

| main route                                                                   | here                                                                                     | why                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/dataset/attachments` (multipart, 200)                             | **kept, working, deprecated**; successor stored-object uploads                           | main publishes it                                                |
| `POST /api/dataset/direct-upload`, `PUT …/staging/:uploadId`                 | **removed**; the browser uses stored-object uploads and `dataset.createFromStoredObject` | web-only on main; dataset no longer stages                       |
| `POST /api/dataset/direct-upload/:datasetId/finalize`, `DELETE …/:datasetId` | **removed**                                                                              | web-only; confirm replaces finalize; an abandoned upload expires |
| `POST /api/dataset/direct-upload/:datasetId/retry`                           | **removed**; the browser calls the `dataset.retryNormalize` tRPC mutation                | web-only; `retryNormalize` is unchanged                          |
| `POST /api/dataset/upload`, `POST /api/dataset/:slugOrId/upload` (multipart) | **kept, working, deprecated**                                                            | the Python SDK calls both                                        |
| `GET /api/files/...`                                                         | same paths, same purpose read permissions                                                | unchanged (§5)                                                   |

The two multipart `/upload` routes and `POST /api/dataset/attachments` are a **time-boxed exception
to the no-bytes rule**.

- The `/upload` pair keeps main's behaviour: a body of up to 25 MB, parsed in the request, over the
  unchanged `createDatasetFromUpload` and `uploadToExistingDataset`.
- `/attachments` keeps main's wire: a multipart body of up to 21 MB (the 20 MB file cap plus framing),
  30 uploads a minute, answered `{ url, name, mediaType, sizeBytes }`. The one deprecated operation
  `storeAttachmentUpload` refuses what main refused, then stores the file through
  `storedObjects.storeFromBytes` with the purpose `dataset_attachment`.
- Each carries `.withDeprecated({ successor, notice })`.
- **Retirement:** in the release after the one carrying this ADR, all three routes answer 410 and
  their operations are deleted. The Python SDK must move to upload-then-create before then.
- Amended 2026-09-24 (coordinator ruling, flagged to Alex): `/attachments` was a 410 until main's
  published wire was weighed against it.
- Amended 2026-09-24 (Alex: "skip 410, just remove if they were web only"): only main's in-app upload
  drove the `/direct-upload*` routes, so all five are removed rather than refused. Nothing answers
  `dataset_upload_route_retired`, and the code goes.
- Amended 2026-09-25 (Alex, apidiff parity): scenario events keep main's server-side extraction of
  inline media into stored objects before dispatch — an explicit exception to "no module parses upload
  bytes", scoped to `/api/scenario-events`; every other upload stays presigned.

### 9. Operation changes (approved by Alex, 2026-09-24)

| #   | operation                                                                                                                                              | kind           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 1   | `StoredObjectApi.createUpload({ projectId, purpose, filename, mediaType, byteLength })` answers `{ objectId, uploadUrl, method, headers?, expiresAt }` | changed        |
| 2   | `StoredObjectApi.confirmUpload({ projectId, objectId })`, answer unchanged                                                                             | changed        |
| 3   | `StoredObjectApi.writeUpload({ objectId, signature, contentLength, body })`: internal, called only by the hidden local signed route                    | **new**        |
| 4   | `StoredObjectApi.readById`, `headById`, `getMetadata`, `getById`: Postgres first, then the legacy ClickHouse index                                     | behaviour only |
| 5   | `StoredObjectApi.storeFromBytes`: fresh KSUID, hashes while it streams, never deduplicates                                                             | behaviour only |
| 6   | `DatasetApi.createDatasetFromStoredObject`                                                                                                             | **new**        |
| 7   | `DatasetApi.appendStoredObjectToDataset`                                                                                                               | **new**        |
| 8   | `DatasetApi.createDatasetFromUpload`, `uploadToExistingDataset`: unchanged, serve only the deprecated routes, deleted at retirement                    | deprecated     |
| 9   | `DatasetApi.createPendingUpload`, `writeStagedUpload`, `finalizeUpload`, `abortPendingUpload`                                                          | **deleted**    |
| 10  | `DatasetApi.upsertDataset`, `batchCreateRecords`, `upsertRecord`: check references                                                                     | behaviour only |
| 11  | `DatasetApi.storeAttachmentUpload`: serves only the deprecated `/attachments` route, deleted at retirement (amended 2026-09-24)                        | deprecated     |

Rows 1, 2 and 5 are narrower than the list Alex approved. The later rulings dropped `actorId`, the
client's `sha256` and content-derived ids. Nothing else changed.

### 10. Migration of what exists on this branch

- **Kept in stored-object:** `rules/stored-object-purpose-permission.rules.ts`
  (`requiredPermissionForPurpose`), now reading the purpose table; the file route's
  `authorizeFilePurpose` step and its any-of-file-view front gate; the `headById` gate; and the bound
  test `stored-object.purpose-permission.unit.test.ts`.
- **Deleted from stored-object:**
  - The `@langwatch/dataset-contract` dependency.
  - `deriveStoredObjectId` and the `idDeriver` infrastructure slot.
  - `StoredObjectUploadTokenCodec`, `UnavailableStoredObjectUploadTokens`, and the `uploadToken` input
    and route parameter.
  - The per-driver repositories under `repositories/{s3,azure,filesystem}`, which move into the member.
  - The drivers, S3 targets and Azure credentials in `stored-object-composition.build.ts`, which move
    into the member.
- **Deleted from dataset:**
  - the three `*.dataset-storage.service.ts` files and `dataset-object-storage-resolver.service.ts`;
  - the staging half of `presigned-upload.rules.ts`;
  - every `/direct-upload*` route, retry included (retry moves to tRPC);
  - the `storageResolver` and `storage` reads.
- **Moved:**
  - `DATASET_ATTACHMENT_PURPOSE` and `REFUSED_ATTACHMENT_MEDIA_TYPES` go to the stored-object contract.
  - The storage config and secrets go to the stores owner.
- **Kept:**
  - existing object ids and keys, which are read as they are;
  - main's chunk keys;
  - the `/api/files` paths;
  - the Postgres `StoredObject` table, with no schema change;
  - the import migration.
- **Schema:** the new nullable `Dataset.sourceStoredObjectId`. `stagingKey` and the `uploading` status
  retire one release later (ADR-155).

## Consequences

- **Where upload bytes enter.** They reach our server only at the local signed route, which streams to
  disk, until the two deprecated multipart routes retire.
- **One flow.** Clients have one flow on every backend: create, PUT, confirm.
- **Readable wherever referenced.** There is one index, and `/api/files` reads it.
- **Every hash is taken over a stream,** once, at confirm or write. Confirming an S3 or Azure upload
  reads it back once: up to 5 GiB for an import.
- **One object per write.** Every write is a new object with a new KSUID. Identical bytes written twice
  are stored twice; that is accepted in exchange for ids that never depend on content. Trace media
  that repeats across spans is stored per write.
- **Reads stay per purpose.** Trace media needs `traces:view`, scenario media `scenarios:view`, and
  dataset attachments and imports `datasets:view`, as on main. Uploads need only `project:update`.
- **Azure caps a single upload at 5000 MiB.** There are no block uploads, so a dataset import on Azure
  larger than that is refused at create.
- **Azure objects after a move to S3 stay unreadable** until the member carries a legacy Azure
  configuration. A recorded address is read by its scheme, but only with the credentials the
  project's current backend has. This is a post-merge gap that needs a config design.
- **`storeFromBytes` still collects a stream input** (at most 100 MiB) to learn its length, because
  the member's write needs `byteLength` up front. Every caller passes a buffer today; a follow-up.
- **New schema and codes.** One new nullable column, one new error code, no new secret and no new
  environment variable.
