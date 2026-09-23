/**
 * The server half of `signInSecurity.*`: reading takes `organization:view`,
 * saving and releasing take `organization:manage`. Mounted on every plan; the
 * plan refuses per organization, inside `save`, only when a rule turns on.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { AuthApi, signInSecurityTrpc } from "@langwatch/auth-contract";

export const signInSecurityTrpcTransport = defineTrpcRouter(AuthApi, signInSecurityTrpc)
  .procedure("get")
  .withPermission("organization:view")
  .handle(({ app, input }) =>
    app.getSignInSecuritySettings({ organizationId: input.organizationId }),
  )

  .procedure("save")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.saveSignInSecuritySettings(input))

  .procedure("release")
  .withPermission("organization:manage")
  .handle(({ app, input, actor }) =>
    app.releaseHeldAccount({
      organizationId: input.organizationId,
      userId: input.userId,
      actorUserId: actor.id,
    }),
  )
  .build();
