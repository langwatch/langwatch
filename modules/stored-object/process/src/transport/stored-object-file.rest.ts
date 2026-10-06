/**
 * `/api/files` — the bytes of one stored object, for a project key. The key is
 * pinned to its own project and reads every file there, as on main; the owner
 * is resolved by the module and must be the key's project.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestBytesProducer,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import {
  storedObjectFileRouteFilenameQuerySchema,
  storedObjectFileRouteIdParamsSchema,
  storedObjectFileRouteNamedParamsSchema,
  storedObjectFileRouteScopedParamsSchema,
} from "@langwatch/stored-object-contract";

import type {
  StoredObjectFileBytes,
  StoredObjectFileReadInput,
} from "../rules/stored-object-file-access.rules.ts";

/** What the byte door reaches: one read that counts, authorizes and streams. */
export interface StoredObjectFileApi {
  readFile(input: StoredObjectFileReadInput): Promise<StoredObjectFileBytes>;
}

export const StoredObjectFileApi = moduleApi<StoredObjectFileApi>()("stored-object");

const KEY_PINNED_TO_OWNER =
  "an object is addressed by its id, so the project that owns it is a read the module " +
  "makes; the key is then refused unless that owner is its own project";

/**
 * The object's own media type where the readback allowlist admits it, and
 * `application/octet-stream` where it does not.
 */
const SERVED_MEDIA_TYPES = "*/*";

/**
 * `/api/files/:projectId/:id` (issue #4947) and the id-only URL minted before
 * it, at exactly the addresses they have always answered. Literal because the
 * two differ in shape rather than in vintage.
 */
export const storedObjectFileRest = defineRestRouter(StoredObjectFileApi)
  .withNamespace("files")
  .withVersion(MANAGEMENT_API_VERSION)
  // REST is the API key's (ARCHITECTURE.md §8): the UI reads media through tRPC.
  .withCredential("project")
  .withAddressing("literal", { v1Twin: true })

  // The last segment of a dataset attachment reference names the file, so the
  // browser downloads it under its own name; the bytes are the scoped route's.
  .get("/api/files/:projectId/:storedObjectId/:filename", "readNamedProjectStoredObjectBytes")
  .withParams(storedObjectFileRouteNamedParamsSchema)
  .withAccess(anyAuthenticated({ reason: KEY_PINNED_TO_OWNER }))
  .withResponse("bytes", { produces: SERVED_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, scope, response }) =>
    served({
      response,
      file: await app.readFile({
        caller: { apiKeyProjectId: scope.id },
        id: input.storedObjectId,
        claimedProjectId: input.projectId,
        requestedFilename: input.filename,
      }),
    }),
  )

  .get("/api/files/:projectId/:storedObjectId", "readProjectStoredObjectBytes")
  .withParams(storedObjectFileRouteScopedParamsSchema)
  .withQuery(storedObjectFileRouteFilenameQuerySchema)
  .withAccess(anyAuthenticated({ reason: KEY_PINNED_TO_OWNER }))
  .withResponse("bytes", { produces: SERVED_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, scope, response }) =>
    served({
      response,
      file: await app.readFile({
        caller: { apiKeyProjectId: scope.id },
        id: input.storedObjectId,
        claimedProjectId: input.projectId,
        requestedFilename: input.filename,
      }),
    }),
  )

  .get("/api/files/:storedObjectId", "readStoredObjectBytes")
  .withParams(storedObjectFileRouteIdParamsSchema)
  .withQuery(storedObjectFileRouteFilenameQuerySchema)
  .withAccess(anyAuthenticated({ reason: KEY_PINNED_TO_OWNER }))
  .withResponse("bytes", { produces: SERVED_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, scope, response }) =>
    served({
      response,
      file: await app.readFile({
        caller: { apiKeyProjectId: scope.id },
        id: input.storedObjectId,
        requestedFilename: input.filename,
      }),
    }),
  )
  .build();

/** The 200, with the length and headers the module decided; HEAD cancels the unsent stream. */
function served(input: {
  response: RestBytesProducer<typeof SERVED_MEDIA_TYPES>;
  file: StoredObjectFileBytes;
}) {
  return input.response.stream(input.file.stream, {
    mediaType: input.file.mediaType,
    byteLength: input.file.byteLength,
    headers: input.file.headers,
  });
}
