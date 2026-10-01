/**
 * The server half of `storedObjects.*`: a permission and a handler per
 * procedure the contract already named. Names, kinds and schemas are not
 * repeated here.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { StoredObjectApi, storedObjectTrpc } from "@langwatch/stored-object-contract";

export const storedObjectTrpcTransport: TrpcRouterDeclaration<
  StoredObjectApi,
  typeof storedObjectTrpc
> = defineTrpcRouter(StoredObjectApi, storedObjectTrpc)
  /** Main's two-step read check: any file-view permission here, the purpose's in the service. */
  .procedure("headById")
  .withPermission({
    kind: "permission-any",
    permissions: ["traces:view", "scenarios:view", "datasets:view"],
  })
  .handle(async ({ app, input, actor }) =>
    app.headById({ projectId: input.projectId, id: input.id }, actor),
  )

  /** The same two-step check, then a short-lived signed URL the browser renders from. */
  .procedure("getReadUrl")
  .withPermission({
    kind: "permission-any",
    permissions: ["traces:view", "scenarios:view", "datasets:view"],
  })
  .handle(async ({ app, input, actor }) => app.getReadUrl(input, actor))

  .procedure("createUpload")
  .withPermission("project:update")
  .handle(async ({ app, input }) => app.createUpload(input))

  .procedure("confirmUpload")
  .withPermission("project:update")
  .handle(async ({ app, input }) => app.confirmUpload(input))
  .build();
