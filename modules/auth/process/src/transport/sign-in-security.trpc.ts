/**
 * `signInSecurity.*`: reading takes `organization:view`, saving and releasing
 * `organization:manage`. `save` asks the plan in its service, because it reads
 * stored settings and so cannot be a declared `when(input)`.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { AuthApi, signInSecurityTrpc } from "@langwatch/auth-contract";

export const signInSecurityTrpcTransport: TrpcRouterDeclaration<
  AuthApi,
  typeof signInSecurityTrpc
> = defineTrpcRouter(AuthApi, signInSecurityTrpc)
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
