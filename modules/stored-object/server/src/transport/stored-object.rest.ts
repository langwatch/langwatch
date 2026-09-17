/**
 * The public stored-object family, at the dated address it has always carried.
 * `storedObjects.createUpload` is NOT here: its answer is a discriminated union
 * and `withOutput` takes an object, an array or nothing.
 */
import { defineRestRouter } from "@langwatch/api/rest";
import {
  StoredObjectApi,
  storedObjectsConfirmUploadInputSchema,
  storedObjectsConfirmUploadOutputSchema,
  storedObjectsDeleteInputSchema,
  storedObjectsDeleteOutputSchema,
  storedObjectsGetInputSchema,
  storedObjectsGetOutputSchema,
} from "@langwatch/stored-object-contract";

export const STORED_OBJECTS_PUBLIC_API_VERSION = "2026-08-22" as const;

export const storedObjectRest = defineRestRouter(StoredObjectApi)
  .withNamespace("stored-objects")
  .withVersion(STORED_OBJECTS_PUBLIC_API_VERSION)

  .post("/:uploadToken/confirmation", "confirmStoredObjectUpload")
  .withParams(storedObjectsConfirmUploadInputSchema.pick({ uploadToken: true }))
  .withInput(storedObjectsConfirmUploadInputSchema.pick({ projectId: true }))
  .withPermission("project:update")
  .withOutput(storedObjectsConfirmUploadOutputSchema)
  .withDocs({ tags: ["Stored Objects"], summary: "Confirm a stored-object upload" })
  .handle(async ({ app, input }) => app.confirmUpload(input))

  .get("/:id", "getStoredObject")
  .withParams(storedObjectsGetInputSchema.pick({ id: true }))
  .withQuery(storedObjectsGetInputSchema.pick({ projectId: true, audience: true }))
  .withPermission("project:view")
  .withOutput(storedObjectsGetOutputSchema)
  .withDocs({ tags: ["Stored Objects"], summary: "Resolve a fresh stored-object capability" })
  .handle(async ({ app, input }) => app.resolveDelivery(input))

  .delete("/:id", "deleteStoredObject")
  .withParams(storedObjectsDeleteInputSchema.pick({ id: true }))
  .withInput(storedObjectsDeleteInputSchema.pick({ projectId: true, idempotencyKey: true }))
  .withPermission("project:manage")
  .withOutput(storedObjectsDeleteOutputSchema)
  .withDocs({ tags: ["Stored Objects"], summary: "Delete a stored object" })
  .handle(async ({ app, input }) => app.delete(input))
  .build();
