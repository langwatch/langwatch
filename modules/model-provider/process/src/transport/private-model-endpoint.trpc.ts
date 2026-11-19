/**
 * The server half of `privateModelEndpoint.*` (ADR-203). Organization managers bind hostnames
 * with `organization:manage`; only staff holding `ops:manage` at the platform register,
 * change or remove an endpoint, and anyone who is not staff is answered not-found there.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { ModelProviderApi, privateModelEndpointTrpc } from "@langwatch/model-provider-contract";

/** Staff hold ops:view at the platform; anyone else is answered not-found. */
const STAFF = { at: "platform", hiddenWithout: "ops:view" } as const;

export const privateModelEndpointTrpcTransport: TrpcRouterDeclaration<
  ModelProviderApi,
  typeof privateModelEndpointTrpc
> = defineTrpcRouter(ModelProviderApi, privateModelEndpointTrpc)
  .procedure("listForOrganization")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.listPrivateEndpointsForOrganization({ organizationId: input.organizationId }),
  )

  .procedure("bind")
  .withPermission("organization:manage")
  .handle(({ app, input, actor }) => app.bindPrivateEndpointHostname(input, actor))

  .procedure("rebind")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.rebindPrivateEndpointHostname(input))

  .procedure("unbind")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.unbindPrivateEndpointHostname(input))

  .procedure("listForStaff")
  .withPermission("ops:view", STAFF)
  .handle(({ app, input }) =>
    app.listPrivateEndpointsForStaff({ organizationId: input.organizationId }),
  )

  .procedure("register")
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input, actor }) => app.registerPrivateEndpoint(input, actor))

  .procedure("update")
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }) => app.updatePrivateEndpoint(input))

  .procedure("remove")
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }) => app.removePrivateEndpoint(input))
  .build();
