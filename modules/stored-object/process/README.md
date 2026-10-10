# @langwatch/stored-object-process

The server half of [stored-object](../README.md). Stored objects: uploads and stored bytes, their metadata, and how each is delivered back.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("stored-object").withRepositories(storedObjectRepositories).withChannels(storedObjectChannels).withApi(StoredObjectModule).withTransports(storedObjectRest, storedObjectFileRest, storedObjectImageProxyRest, storedObjectTrpcTransport).withMigrations(…)`, `src/stored-object.module.ts:17`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`StoredObjectApi`)

The complete process capability exposed by the stored-object feature.

Peers call these through the token, declared at `../contract/src/stored-object.api.ts:118`; nothing else in this package is public.

#### `storeFromBytes`

```typescript
storeFromBytes(input: StoreStoredObjectFromBytesInput): Promise<StoreStoredObjectFromBytesResult>;
```

#### `createUpload`

```typescript
createUpload(input: CreateStoredObjectUploadInput): Promise<StoredObjectsCreateUploadOutput>;
```

#### `confirmUpload`

```typescript
confirmUpload(input: ConfirmStoredObjectUploadInput): Promise<StoredObjectReference>;
```

#### `writeUpload`

Internal: called only by the hidden local signed route.

```typescript
writeUpload(input: WriteStoredObjectUploadInput): Promise<void>;
```

#### `getMetadata`

```typescript
getMetadata(input: { projectId: StoredObjectProjectId; id: StoredObjectId; }): Promise<StoredObjectMetadata>;
```

#### `getById`

```typescript
getById(input: { projectId: StoredObjectProjectId; id: StoredObjectId; }): Promise<ReadStoredObjectResult>;
```

#### `resolveDelivery`

```typescript
resolveDelivery(input: StoredObjectsGetInput): Promise<StoredObjectsGetOutput>;
```

#### `delete`

```typescript
delete(input: DeleteStoredObjectInput): Promise<StoredObjectsDeleteOutput>;
```

#### `getStorageUsageByProject`

```typescript
getStorageUsageByProject(input: { projectId: StoredObjectProjectId; purpose?: string; }): Promise<StoredObjectStorageUsage>;
```

#### `deleteOwnedBy`

```typescript
deleteOwnedBy(input: { projectId: StoredObjectProjectId; }): Promise<DeleteProjectStoredObjectsResult>;
```

#### `headById`

Holds `by` to the permission the object's purpose names; the transport admits any file viewer first.

```typescript
headById(input: { projectId: string; id: string }, by: Readonly<{ id: string }>): Promise<StoredObjectHead>;
```

#### `getReadUrl`

A signed read URL for `by`, held to any file-view permission by the transport and to the object's purpose permission here.

```typescript
getReadUrl(input: StoredObjectReadUrlInput, by: Readonly<{ id: string }>): Promise<StoredObjectReadUrl>;
```

#### `getReadUrlForPurpose`

A signed read URL for a peer that gates its own readers, minted only when the object carries the purpose and owner kind named; not found otherwise.

```typescript
getReadUrlForPurpose(input: { projectId: string; id: string; purpose: string; ownerKind: string; }): Promise<StoredObjectReadUrl>;
```

#### `getSignedContent`

Internal: called only by the signed read route. The signature is the credential.

```typescript
getSignedContent(input: { objectId: string; signature: string; }): Promise<StoredObjectSignedContent>;
```

#### `readById`

Throws `StoredObjectNotFoundError` when the project holds no such row.

```typescript
readById(input: { projectId: string; id: string }): Promise<StoredObjectFileRead>;
```

#### `resolveOwner`

Throws `StoredObjectNotFoundError` when no instance holds the id.

```typescript
resolveOwner(input: { id: string }): Promise<{ projectId: string }>;
```

#### `getStorageDestination`

Where this project's objects are written, for the checkup.

```typescript
getStorageDestination(input: { projectId: StoredObjectProjectId; }): Promise<StoredObjectStorageDestination>;
```

#### `probeStorage`

Writes a small object where the project's objects go, then removes it; throws on refusal.

```typescript
probeStorage(input: { projectId: StoredObjectProjectId }): Promise<void>;
```

## REST transport

### `storedObjectFileRest`

|             |                                               |
| ----------- | --------------------------------------------- |
| Declared at | `src/transport/stored-object-file.rest.ts:47` |
| Base URL    | none: each route's path is its address        |
| Addressing  | literal                                       |
| Credential  | project                                       |

#### `GET,HEAD /api/files/:projectId/:storedObjectId/:filename` · `readNamedProjectStoredObjectBytes`

Authenticated: an object is addressed by its id, so the project that owns it is a read the module makes; the key is then refused unless that owner is its own project. Declared at `src/transport/stored-object-file.rest.ts:56`.

Answers at `/api/files/:projectId/:storedObjectId/:filename`, `/api/v1/files/:projectId/:storedObjectId/:filename`.

```typescript
// Params: storedObjectFileRouteNamedParamsSchema, ../contract/src/stored-object-file-route.ts:17
interface Params {
  projectId: string;
  storedObjectId: string;
  filename: string;
}
// Response: inline, src/transport/stored-object-file.rest.ts:59
type Response = unknown;
```

#### `GET,HEAD /api/files/:projectId/:storedObjectId` · `readProjectStoredObjectBytes`

Authenticated: an object is addressed by its id, so the project that owns it is a read the module makes; the key is then refused unless that owner is its own project. Declared at `src/transport/stored-object-file.rest.ts:73`.

Answers at `/api/files/:projectId/:storedObjectId`, `/api/v1/files/:projectId/:storedObjectId`.

```typescript
// Params: storedObjectFileRouteScopedParamsSchema, ../contract/src/stored-object-file-route.ts:8
interface Params {
  projectId: string;
  storedObjectId: string;
}
// Query: storedObjectFileRouteFilenameQuerySchema, ../contract/src/stored-object-file-route.ts:33
interface Query {
  filename?: string;
}
// Response: inline, src/transport/stored-object-file.rest.ts:77
type Response = unknown;
```

#### `GET,HEAD /api/files/:storedObjectId` · `readStoredObjectBytes`

Authenticated: an object is addressed by its id, so the project that owns it is a read the module makes; the key is then refused unless that owner is its own project. Declared at `src/transport/stored-object-file.rest.ts:91`.

Answers at `/api/files/:storedObjectId`, `/api/v1/files/:storedObjectId`.

```typescript
// Params: storedObjectFileRouteIdParamsSchema, ../contract/src/stored-object-file-route.ts:25
interface Params {
  storedObjectId: string;
}
type Query = z.infer<typeof storedObjectFileRouteFilenameQuerySchema>; // ../contract/src/stored-object-file-route.ts:33
// Response: inline, src/transport/stored-object-file.rest.ts:95
type Response = unknown;
```

### `storedObjectImageProxyRest`

|             |                                                      |
| ----------- | ---------------------------------------------------- |
| Declared at | `src/transport/stored-object-image-proxy.rest.ts:17` |
| Base URL    | none: each route's path is its address               |
| Addressing  | literal                                              |
| Credential  | project                                              |

#### `GET /api/image-proxy` · `proxyExternalImage`

Public: an <img> fires with no credential; every address is fenced by the SSRF egress policy. Hidden from the OpenAPI document. Declared at `src/transport/stored-object-image-proxy.rest.ts:22`.

Answers at `/api/image-proxy`.

```typescript
// Query: imageProxyQuerySchema, ../contract/src/stored-object-file-route.ts:41
interface Query {
  url?: string;
}
// Response: inline, src/transport/stored-object-image-proxy.rest.ts:30
type Response = unknown;
```

### `storedObjectRest`

|             |                                                      |
| ----------- | ---------------------------------------------------- |
| Declared at | `src/transport/stored-object.rest.ts:42`             |
| Base URL    | `/api/stored-objects`, twin `/api/v1/stored-objects` |
| Addressing  | dated                                                |
| Credential  | project                                              |
| Versions    | `2026-08-22`                                         |

#### `POST /uploads` · `createStoredObjectUpload`

Create a stored-object upload

Permission `project:update`. Declared at `src/transport/stored-object.rest.ts:46`.

Answers at `/api/stored-objects/uploads`, `/api/v1/stored-objects/uploads`; also, undocumented, `/api/stored-objects/2026-08-22/uploads`, `/api/v1/stored-objects/2026-08-22/uploads`, `/api/stored-objects/latest/uploads`, `/api/v1/stored-objects/latest/uploads`.

```typescript
// Body: storedObjectsCreateUploadInputSchema, ../contract/src/uploads.ts:13
interface Body {
  projectId: string;
  purpose: string;
  filename: string;
  mediaType: string;
  byteLength: number;
}
// Response: storedObjectsCreateUploadOutputSchema, ../contract/src/uploads.ts:24
interface Response {
  objectId: string;
  uploadUrl: string;
  method: "PUT";
  headers?: Record<string, string>;
  expiresAt: string;
}
```

#### `POST /uploads/:storedObjectId/confirmation` · `confirmStoredObjectUpload`

Confirm a stored-object upload

Permission `project:update`. Declared at `src/transport/stored-object.rest.ts:57`.

Answers at `/api/stored-objects/uploads/:storedObjectId/confirmation`, `/api/v1/stored-objects/uploads/:storedObjectId/confirmation`; also, undocumented, `/api/stored-objects/2026-08-22/uploads/:storedObjectId/confirmation`, `/api/v1/stored-objects/2026-08-22/uploads/:storedObjectId/confirmation`, `/api/stored-objects/latest/uploads/:storedObjectId/confirmation`, `/api/v1/stored-objects/latest/uploads/:storedObjectId/confirmation`.

```typescript
// Params: storedObjectParamsSchema, ../contract/src/uploads.ts:49
interface Params {
  storedObjectId: string;
}
// Body: inline, src/transport/stored-object.rest.ts:59
interface Body {
  projectId: string;
}
type Response = z.infer<typeof storedObjectsConfirmUploadOutputSchema>; // ../contract/src/uploads.ts:43
```

#### `PUT /uploads/:storedObjectId/content` · `putStoredObjectUploadContent`

Public: signed URL: the sealed signature in the query is the credential. Hidden from the OpenAPI document. Declared at `src/transport/stored-object.rest.ts:71`.

Answers at `/api/stored-objects/uploads/:storedObjectId/content`, `/api/v1/stored-objects/uploads/:storedObjectId/content`; also, undocumented, `/api/stored-objects/2026-08-22/uploads/:storedObjectId/content`, `/api/v1/stored-objects/2026-08-22/uploads/:storedObjectId/content`, `/api/stored-objects/latest/uploads/:storedObjectId/content`, `/api/v1/stored-objects/latest/uploads/:storedObjectId/content`.

```typescript
type Params = z.infer<typeof storedObjectParamsSchema>; // ../contract/src/uploads.ts:49
// Query: inline, src/transport/stored-object.rest.ts:73
interface Query {
  sig: string;
}
// Rawbody: "stream" (inline, src/transport/stored-object.rest.ts:74)
// Response: inline, src/transport/stored-object.rest.ts:76
interface Response {
  ok: true;
}
```

#### `GET,HEAD /:storedObjectId/content` · `getStoredObjectContent`

Public: signed URL: the sealed signature in the query is the credential. Hidden from the OpenAPI document. Declared at `src/transport/stored-object.rest.ts:90`.

Answers at `/api/stored-objects/:storedObjectId/content`, `/api/v1/stored-objects/:storedObjectId/content`; also, undocumented, `/api/stored-objects/2026-08-22/:storedObjectId/content`, `/api/v1/stored-objects/2026-08-22/:storedObjectId/content`, `/api/stored-objects/latest/:storedObjectId/content`, `/api/v1/stored-objects/latest/:storedObjectId/content`.

```typescript
type Params = z.infer<typeof storedObjectParamsSchema>; // ../contract/src/uploads.ts:49
// Query: inline, src/transport/stored-object.rest.ts:92
interface Query {
  sig: string;
}
// Response: inline, src/transport/stored-object.rest.ts:94
type Response = unknown;
```

#### `GET /:storedObjectId` · `getStoredObject`

Resolve a fresh stored-object capability

Permission `project:view`. Declared at `src/transport/stored-object.rest.ts:106`.

Answers at `/api/stored-objects/:storedObjectId`, `/api/v1/stored-objects/:storedObjectId`; also, undocumented, `/api/stored-objects/2026-08-22/:storedObjectId`, `/api/v1/stored-objects/2026-08-22/:storedObjectId`, `/api/stored-objects/latest/:storedObjectId`, `/api/v1/stored-objects/latest/:storedObjectId`.

```typescript
// Params: inline, src/transport/stored-object.rest.ts:107
interface Params {
  storedObjectId: string;
}
// Query: storedObjectsGetInputSchema.pick({ projectId: true, audience: true }) (inline, src/transport/stored-object.rest.ts:108)
type Response = z.infer<typeof storedObjectsGetOutputSchema>; // ../contract/src/stored-object.commands.ts:29
```

#### `DELETE /:storedObjectId` · `deleteStoredObject`

Delete a stored object

Permission `project:manage`. Declared at `src/transport/stored-object.rest.ts:120`.

Answers at `/api/stored-objects/:storedObjectId`, `/api/v1/stored-objects/:storedObjectId`; also, undocumented, `/api/stored-objects/2026-08-22/:storedObjectId`, `/api/v1/stored-objects/2026-08-22/:storedObjectId`, `/api/stored-objects/latest/:storedObjectId`, `/api/v1/stored-objects/latest/:storedObjectId`.

```typescript
// Params: inline, src/transport/stored-object.rest.ts:121
interface Params {
  storedObjectId: string;
}
// Body: inline, src/transport/stored-object.rest.ts:122
interface Body {
  projectId: string;
  idempotencyKey: string;
}
// Response: storedObjectsDeleteOutputSchema, ../contract/src/stored-object.commands.ts:46
interface Response {
  id: string;
  generation: number;
  deletedAt: string;
}
```

## tRPC transport

### `storedObjects`

Contract `../contract/src/stored-object.trpc.ts:45`, router `src/transport/stored-object.trpc.ts:12`.

| Procedure                     | Kind     | Gate                                                        | Input                                   | Output                                   |
| ----------------------------- | -------- | ----------------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| `storedObjects.headById`      | query    | Permission `traces:view or scenarios:view or datasets:view` | `storedObjectHeadInputSchema`           | `storedObjectHeadSchema`                 |
| `storedObjects.getReadUrl`    | query    | Permission `traces:view or scenarios:view or datasets:view` | `storedObjectReadUrlInputSchema`        | `storedObjectReadUrlSchema`              |
| `storedObjects.createUpload`  | mutation | Permission `project:update`                                 | `storedObjectsCreateUploadInputSchema`  | `storedObjectsCreateUploadOutputSchema`  |
| `storedObjects.confirmUpload` | mutation | Permission `project:update`                                 | `storedObjectsConfirmUploadInputSchema` | `storedObjectsConfirmUploadOutputSchema` |

```typescript
// storedObjects.headById
// Input: storedObjectHeadInputSchema, ../contract/src/stored-object.trpc.ts:16
interface Input {
  projectId: string;
  id: string;
}
// Output: storedObjectHeadSchema, ../contract/src/stored-object.trpc.ts:26
type Output =
  | {
      status: "available";
      mediaType: string;
    }
  | {
      status: "missing";
      mediaType: string;
    }
  | {
      status: "not_found";
    };

// storedObjects.getReadUrl
// Input: storedObjectReadUrlInputSchema, ../contract/src/stored-object.trpc.ts:33
interface Input {
  projectId: string;
  storedObjectId: string;
  filename?: string;
}
// Output: storedObjectReadUrlSchema, ../contract/src/stored-object.trpc.ts:42
interface Output {
  url: string;
}

// storedObjects.createUpload
type Input = z.infer<typeof storedObjectsCreateUploadInputSchema>; // ../contract/src/uploads.ts:13
type Output = z.infer<typeof storedObjectsCreateUploadOutputSchema>; // ../contract/src/uploads.ts:24

// storedObjects.confirmUpload
// Input: storedObjectsConfirmUploadInputSchema, ../contract/src/uploads.ts:35
interface Input {
  projectId: string;
  objectId: string;
}
type Output = z.infer<typeof storedObjectsConfirmUploadOutputSchema>; // ../contract/src/uploads.ts:43
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: stored-object declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf                            | Environment variable                   | Declared at                                  |
| ------ | ------------------------------- | -------------------------------------- | -------------------------------------------- |
| config | `objectRetentionConfirmed`      | `OBJECT_RETENTION_CONFIRMED`           | `../contract/src/stored-object.config.ts:25` |
| config | `legacySpoolRetentionConfirmed` | `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED` | `../contract/src/stored-object.config.ts:27` |
| config | `blockLocalHttpCalls`           | `BLOCK_LOCAL_HTTP_CALLS`               | `../contract/src/stored-object.config.ts:29` |
| config | `allowedProxyHosts`             | `ALLOWED_PROXY_HOSTS`                  | `../contract/src/stored-object.config.ts:30` |
| config | `isSaas`                        | `IS_SAAS`                              | `../contract/src/stored-object.config.ts:32` |
| config | `publicBaseUrl`                 | `BASE_HOST`                            | `../contract/src/stored-object.config.ts:34` |

<!-- readme:generated:end -->
