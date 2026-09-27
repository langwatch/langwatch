/**
 * `/api/files` — the bytes of one stored object, for the page that renders it
 * and for the project key that fetches it. An object is addressed by its id,
 * so the owning project is resolved by the module, not by the door.
 */
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestBytesProducer,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import {
  storedObjectFileRouteFilenameQuerySchema,
  storedObjectFileRouteIdParamsSchema,
  storedObjectFileRouteNamedParamsSchema,
  storedObjectFileRouteScopedParamsSchema,
} from "@langwatch/stored-object-contract";

import type { StoredObjectFileBytes, StoredObjectFileReadInput } from "#app/stored-object.members";

/** What the byte door reaches: one read that counts, authorizes and streams. */
export interface StoredObjectFileApi {
  readFile(input: StoredObjectFileReadInput): Promise<StoredObjectFileBytes>;
}

export const StoredObjectFileApi = moduleApi<StoredObjectFileApi>()("stored-object");

const OWNER_RESOLVED_IN_HANDLER =
  "an object is addressed by its id, so the project that owns it is a read this handler " +
  "makes; the caller is then authorized against the owner it found";

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
  // The browser's own door: an `<img>` or `<audio>` fires with a cookie and no
  // headers, so no API client can present what opens this family and it
  // publishes no operation. A project API key opens the SAME door.
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: true })

  // The last segment of a dataset attachment reference names the file, so the
  // browser downloads it under its own name; the bytes are the scoped route's.
  .get("/api/files/:projectId/:storedObjectId/:filename", "readNamedProjectStoredObjectBytes")
  .withParams(storedObjectFileRouteNamedParamsSchema)
  .withAccess(deferredScope({ reason: OWNER_RESOLVED_IN_HANDLER }))
  .withResponse("bytes", { produces: SERVED_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, actor, response }) =>
    served({
      response,
      file: await app.readFile({
        actor,
        id: input.storedObjectId,
        claimedProjectId: input.projectId,
        requestedFilename: input.filename,
      }),
    }),
  )

  .get("/api/files/:projectId/:storedObjectId", "readProjectStoredObjectBytes")
  .withParams(storedObjectFileRouteScopedParamsSchema)
  .withQuery(storedObjectFileRouteFilenameQuerySchema)
  .withAccess(deferredScope({ reason: OWNER_RESOLVED_IN_HANDLER }))
  .withResponse("bytes", { produces: SERVED_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, actor, response }) =>
    served({
      response,
      file: await app.readFile({
        actor,
        id: input.storedObjectId,
        claimedProjectId: input.projectId,
        requestedFilename: input.filename,
      }),
    }),
  )

  .get("/api/files/:storedObjectId", "readStoredObjectBytes")
  .withParams(storedObjectFileRouteIdParamsSchema)
  .withQuery(storedObjectFileRouteFilenameQuerySchema)
  .withAccess(deferredScope({ reason: OWNER_RESOLVED_IN_HANDLER }))
  .withResponse("bytes", { produces: SERVED_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, actor, response }) =>
    served({
      response,
      file: await app.readFile({
        actor,
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
