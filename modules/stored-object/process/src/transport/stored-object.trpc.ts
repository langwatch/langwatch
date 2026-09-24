/**
 * The server half of `storedObjects.*`: a permission and a handler per
 * procedure the contract already named. Names, kinds and schemas are not
 * repeated here.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { StoredObjectApi, storedObjectTrpc } from "@langwatch/stored-object-contract";

export const storedObjectTrpcTransport = defineTrpcRouter(StoredObjectApi, storedObjectTrpc)
  /** Main's two-step read check: any file-view permission here, the purpose's in the service. */
  .procedure("headById")
  .withPermission({
    kind: "permission-any",
    permissions: ["traces:view", "scenarios:view", "datasets:view"],
  })
  .handle(async ({ app, input, actor }) =>
    app.headById({ projectId: input.projectId, id: input.id }, actor),
  )

  .procedure("createUpload")
  .withPermission("project:update")
  .handle(async ({ app, input }) => app.createUpload(input))

  .procedure("confirmUpload")
  .withPermission("project:update")
  .handle(async ({ app, input }) => app.confirmUpload(input))
  .build();
