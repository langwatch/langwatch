/**
 * The public stored-object family, at the dated address it has always carried,
 * with ADR-158 §4's upload routes: create, confirm, and the hidden local PUT.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, ForbiddenError } from "@langwatch/api/rest";
import type { AuthzDeclaredScopeId } from "@langwatch/authorization";
import {
  StoredObjectApi,
  storedObjectParamsSchema,
  storedObjectUploadSignatureSchema,
  storedObjectsConfirmUploadInputSchema,
  storedObjectsConfirmUploadOutputSchema,
  storedObjectsCreateUploadInputSchema,
  storedObjectsCreateUploadOutputSchema,
  storedObjectsDeleteInputSchema,
  storedObjectsDeleteOutputSchema,
  storedObjectsGetInputSchema,
  storedObjectsGetOutputSchema,
} from "@langwatch/stored-object-contract";
import { z } from "zod";

export const STORED_OBJECTS_PUBLIC_API_VERSION = "2026-08-22" as const;

const SIGNED_URL = "signed URL: the sealed signature in the query is the credential";

/** The project a request names, once it is the key's own: another project's key is refused. */
const ownProject = ({
  scope,
  projectId,
}: {
  scope: AuthzDeclaredScopeId | null;
  projectId: string;
}) => {
  if (scope?.tier !== "project" || scope.id !== projectId) {
    throw new ForbiddenError("This key does not reach that project");
  }
  return projectId;
};

export const storedObjectRest = defineRestRouter(StoredObjectApi)
  .withNamespace("stored-objects")
  .withVersion(STORED_OBJECTS_PUBLIC_API_VERSION)

  .post("/uploads", "createStoredObjectUpload")
  .withInput(storedObjectsCreateUploadInputSchema)
  .withPermission("project:update")
  .withOutput(storedObjectsCreateUploadOutputSchema)
  .withDocs({ tags: ["Stored Objects"], summary: "Create a stored-object upload" })
  .handle(async ({ app, input, scope }) =>
    app.createUpload({ ...input, projectId: ownProject({ scope, projectId: input.projectId }) }),
  )

  .post("/uploads/:storedObjectId/confirmation", "confirmStoredObjectUpload")
  .withParams(storedObjectParamsSchema)
  .withInput(storedObjectsConfirmUploadInputSchema.pick({ projectId: true }))
  .withPermission("project:update")
  .withOutput(storedObjectsConfirmUploadOutputSchema)
  .withDocs({ tags: ["Stored Objects"], summary: "Confirm a stored-object upload" })
  .handle(async ({ app, input, scope }) =>
    app.confirmUpload({
      projectId: ownProject({ scope, projectId: input.projectId }),
      objectId: input.storedObjectId,
    }),
  )

  .put("/uploads/:storedObjectId/content", "putStoredObjectUploadContent")
  .withParams(storedObjectParamsSchema)
  .withQuery(z.object({ sig: storedObjectUploadSignatureSchema }))
  .withRawBody("stream")
  .withAccess(publicRoute({ reason: SIGNED_URL }))
  .withOutput(z.object({ ok: z.literal(true) }))
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw }) => {
    await app.writeUpload({
      objectId: input.storedObjectId,
      signature: input.sig,
      contentLength: undefined,
      body: raw,
    });

    return { ok: true as const };
  })

  // The signed URL `storedObjects.getReadUrl` mints: any backend's bytes, local disk included.
  .get("/:storedObjectId/content", "getStoredObjectContent")
  .withParams(storedObjectParamsSchema)
  .withQuery(z.object({ sig: storedObjectUploadSignatureSchema }))
  .withAccess(publicRoute({ reason: SIGNED_URL }))
  .withResponse("bytes", { produces: "*/*" })
  .methods(["GET", "HEAD"])
  .withDocs({ hide: true })
  .handle(async ({ app, input, response }) => {
    const content = await app.getSignedContent({
      objectId: input.storedObjectId,
      signature: input.sig,
    });

    return response.stream(content.stream, content);
  })

  .get("/:storedObjectId", "getStoredObject")
  .withParams(z.object({ storedObjectId: storedObjectsGetInputSchema.shape.id }))
  .withQuery(storedObjectsGetInputSchema.pick({ projectId: true, audience: true }))
  .withPermission("project:view")
  .withOutput(storedObjectsGetOutputSchema)
  .withDocs({ tags: ["Stored Objects"], summary: "Resolve a fresh stored-object capability" })
  .handle(async ({ app, input, scope }) =>
    app.resolveDelivery({
      id: input.storedObjectId,
      projectId: ownProject({ scope, projectId: input.projectId }),
      audience: input.audience,
    }),
  )

  .delete("/:storedObjectId", "deleteStoredObject")
  .withParams(z.object({ storedObjectId: storedObjectsDeleteInputSchema.shape.id }))
  .withInput(storedObjectsDeleteInputSchema.pick({ projectId: true, idempotencyKey: true }))
  .withPermission("project:manage")
  .withOutput(storedObjectsDeleteOutputSchema)
  .withDocs({ tags: ["Stored Objects"], summary: "Delete a stored object" })
  .handle(async ({ app, input, scope }) =>
    app.delete({
      id: input.storedObjectId,
      projectId: ownProject({ scope, projectId: input.projectId }),
      idempotencyKey: input.idempotencyKey,
    }),
  )
  .build();
