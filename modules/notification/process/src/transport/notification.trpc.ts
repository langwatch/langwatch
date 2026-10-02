/**
 * The server half of `notification.*`: the caller's own browsers for Web Push.
 * Spec: modules/notification/specs/web-push.feature
 */
import {
  defineTrpcRouter,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import { NotificationService, notificationTrpc } from "@langwatch/notification-contract";

/** Why every procedure below asks for no permission. */
const OWN_BROWSERS = "acts on the session user's own browsers, so no tenant scope applies";

/**
 * Whose browsers these are. While a platform operator browses as somebody, the browser
 * is the operator's, so the pushes stay theirs.
 */
function personOf(actor: TrpcHandlerActor): string {
  return (actor.type === "user" ? actor.impersonatorId : undefined) ?? actor.id;
}

export const notificationTrpcTransport: TrpcRouterDeclaration<
  NotificationService,
  typeof notificationTrpc
> = defineTrpcRouter(NotificationService, notificationTrpc)
  .procedure("webPushPublicKey")
  .noPermission({
    reason: "the VAPID public key is public by design; any signed-in browser subscribes with it",
  })
  .handle(({ app }) => app.getWebPushPublicKey())

  .procedure("subscribeWebPush")
  .noPermission({ reason: OWN_BROWSERS })
  .handle(({ app, actor, input: { userAgent, ...subscription } }) =>
    app.subscribeWebPush({ userId: personOf(actor), subscription, userAgent: userAgent ?? null }),
  )

  .procedure("unsubscribeWebPush")
  .noPermission({ reason: OWN_BROWSERS })
  .handle(({ app, actor, input }) =>
    app.unsubscribeWebPush({ userId: personOf(actor), endpoint: input.endpoint }),
  )
  .build();
