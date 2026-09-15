/**
 * The server half of `secrets.*`: a permission and a handler per declared
 * procedure. Reading takes `secrets:view`, every write `secrets:manage`.
 * Nothing here logs, echoes or copies a value.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { SecretApi, secretTrpc } from "@langwatch/secret-contract";

export const secretTrpcTransport = defineTrpcRouter(SecretApi, secretTrpc)
  .procedure("list")
  .withPermission("secrets:view")
  .handle(async ({ app, input }) => app.list(input))

  .procedure("create")
  .withPermission("secrets:manage")
  .handle(async ({ app, input, actor }) => app.create(input, actor))

  .procedure("update")
  .withPermission("secrets:manage")
  .handle(async ({ app, input, actor }) => {
    await app.update(
      { projectId: input.projectId, id: input.secretId, value: input.value },
      actor,
    );

    return { success: true };
  })

  .procedure("delete")
  .withPermission("secrets:manage")
  .handle(async ({ app, input }) => {
    await app.delete({ projectId: input.projectId, id: input.secretId });

    return { success: true };
  })
  .build();
