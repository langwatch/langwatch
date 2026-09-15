/**
 * The server half of `storedObjects.*`: a permission and a handler per
 * procedure the contract already named. Names, kinds and schemas are not
 * repeated here.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { StoredObjectApi, storedObjectTrpc } from "@langwatch/stored-object-contract";

export const storedObjectTrpcTransport = defineTrpcRouter(StoredObjectApi, storedObjectTrpc)
  /**
   * Either permission suffices: one object is trace media for one viewer and
   * scenario media for another. The primary surface's permission is named
   * first, so a denial names `traces:view` — `/api/files/:id`'s own gate.
   */
  .procedure("headById")
  .withPermission({ kind: "permission-any", permissions: ["traces:view", "scenarios:view"] })
  .handle(async ({ app, input }) => app.headById({ projectId: input.projectId, id: input.id }))
  .build();
