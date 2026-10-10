/**
 * The server half of `user.*`, acting on the session's own account — most
 * ask no permission; the organization-scoped ones take `organization:view`.
 * Spec: modules/user/specs/user.feature, specs/settings/user-avatar.feature.
 */
import {
  browserSessionContext,
  defineTrpcRouter,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import { UserApi, userTrpc, type UserCaller } from "@langwatch/user-contract";

/** Why every account procedure below asks for no permission. */
const OWN_ACCOUNT = "operates on the session user's own account, so no tenant scope applies";

/** Why the avatar URL asks for no permission. */
const ANY_SIGNED_IN =
  "a photo shows wherever a person is shown, across organizations; the object's purpose and owner kind gate it";

/** Why reactivation decides standing in the application. */
const OPERATOR_ONLY =
  "operator-only for the named account; the application enforces operator standing itself, against the platform operator list rather than a tenant";

/**
 * Who is asking. The outer id is the SUBJECT — the account being read and
 * written — and `operatorId` is whose own preferences and operator standing
 * apply, which differ only while a platform operator browses as somebody.
 */
function callerOf(actor: TrpcHandlerActor): UserCaller {
  const operatorId = (actor.type === "user" ? actor.impersonatorId : undefined) ?? actor.id;

  return { id: actor.id, operatorId, impersonated: operatorId !== actor.id };
}

export const userTrpcTransport: TrpcRouterDeclaration<UserApi, typeof userTrpc> = defineTrpcRouter(
  UserApi,
  userTrpc,
)
  .procedure("getAvatarUrl")
  .noPermission({
    reason: ANY_SIGNED_IN,
    allow: {
      projectId:
        "part of the avatar object's address; the read serves only an avatar-purpose, user-owned object",
    },
  })
  .handle(({ app, input }) => app.getAvatarUrl(input))

  .procedure("getTraceExplorerTourPreference")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) =>
    app.getTraceExplorerTourPreference({ id: callerOf(actor).operatorId }),
  )

  .procedure("dismissTraceExplorerTour")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) => app.dismissTraceExplorerTour({ id: callerOf(actor).operatorId }))

  .procedure("getNotificationPreference")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor, input }) =>
    app.getNotificationPreference({ id: callerOf(actor).operatorId, topic: input.topic }),
  )

  .procedure("setNotificationPreference")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor, input }) =>
    app.setNotificationPreference({
      id: callerOf(actor).operatorId,
      topic: input.topic,
      choice: input.choice,
    }),
  )

  .procedure("isAdmin")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor }) => ({
    isAdmin: await app.isOperator({ userId: callerOf(actor).operatorId }),
  }))

  .procedure("updateLastLogin")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) => app.recordSignIn({ caller: callerOf(actor) }))

  .procedure("getSsoStatus")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) => app.getSsoStatus({ id: actor.id }))

  .procedure("getAccountInfo")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) => app.getAccountInfo({ id: actor.id }))

  .procedure("getLinkedAccounts")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) => app.listLinkedAccounts({ userId: actor.id }))

  // The session travels as middleware context: the offer follows how THIS sign-in happened.
  .procedure("secureAccountNudge")
  .withMiddlewareContext(browserSessionContext)
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }, browserSession) =>
    app.getPasskeyOffer({ id: actor.id, sessionId: browserSession ?? null }),
  )

  .procedure("dismissSecureAccountNudge")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor }) => {
    await app.dismissPasskeyNudge({ id: actor.id });

    return { success: true as const };
  })

  // Sessions are not revoked: a cosmetic edit is no reason to sign anybody out.
  .procedure("updateName")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor, input }) => {
    await app.updateProfile({ id: actor.id, name: input.name });

    return { name: input.name };
  })

  .procedure("hasPassword")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor }) => ({ hasPassword: await app.hasPassword({ id: actor.id }) }))

  .procedure("reactivate")
  .noPermission({ reason: OPERATOR_ONLY })
  .handle(async ({ app, actor, input }) => {
    await app.reactivateAccount({ userId: input.userId, caller: callerOf(actor) });

    return { success: true as const };
  })

  // Setting a photo names the organization whose personal workspace stores it,
  // which is a tenant, so this one is permission-checked.
  .procedure("setAvatar")
  .withPermission("organization:view")
  .handle(({ app, actor, input }) =>
    app.setOwnAvatar({
      userId: actor.id,
      organizationId: input.organizationId,
      imageDataUrl: input.imageDataUrl,
    }),
  )

  .procedure("removeAvatar")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor }) => {
    await app.removeAvatar({ userId: actor.id });

    return { success: true as const };
  })

  .procedure("requestBudgetIncrease")
  .withPermission("organization:view")
  .handle(({ app, actor, input }) => app.requestBudgetIncrease({ ...input, userId: actor.id }))

  .procedure("setLastHomePath")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor, input }) => {
    await app.setLastHomePath({ id: actor.id, path: input.path });

    return { ok: true as const };
  })

  .procedure("homePagePickerState")
  .withPermission("organization:view")
  .handle(({ app, actor, input }) =>
    app.getHomePagePickerState({ userId: actor.id, organizationId: input.organizationId }),
  )
  .build();
