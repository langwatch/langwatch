import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { NotificationService, notificationTrpc } from "@langwatch/notification-contract";

export const notificationTrpcTransport: TrpcRouterDeclaration<
  NotificationService,
  typeof notificationTrpc
> = defineTrpcRouter(NotificationService, notificationTrpc)
  .procedure("onReadHints")
  .withPermission("organization:view")
  .handle(({ app, input, actor, signal }) =>
    app.readHints({
      userId: actor.id,
      organizationId: input.organizationId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  .build();
