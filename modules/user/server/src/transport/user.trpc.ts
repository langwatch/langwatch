/**
 * The server half of `user.*`. Every procedure acts on the session's own
 * account, so most ask no permission: there is no tenant scope to check. The
 * organization-scoped ones take `organization:view`. Nothing here catches.
 * Spec: modules/user/specs/user.feature, specs/settings/user-avatar.feature.
 */
import {
  browserSessionFact,
  callerAddressFact,
  defineTrpcRouter,
  type TrpcHandlerActor,
} from "@langwatch/api/trpc";
import { publicRoute } from "@langwatch/api/access";
import { UserApi, userTrpc, type UserCaller } from "@langwatch/user-contract";

/** Why every account procedure below asks for no permission. */
const OWN_ACCOUNT = "operates on the session user's own account, so no tenant scope applies";

/** Why the two lifecycle procedures decide standing in the application. */
const SELF_OR_OPERATOR =
  "self-service for the named account; the application enforces self-or-operator itself, against the platform operator list rather than a tenant";

/**
 * Who is asking. The outer id is the SUBJECT — the account being read and
 * written — and `operatorId` is whose own preferences and operator standing
 * apply, which differ only while a platform operator browses as somebody.
 */
function callerOf(actor: TrpcHandlerActor): UserCaller {
  const operatorId = (actor.type === "user" ? actor.impersonatorId : undefined) ?? actor.id;

  return { id: actor.id, operatorId, impersonated: operatorId !== actor.id };
}

export const userTrpcTransport = defineTrpcRouter(UserApi, userTrpc)
  // `register` predates the account it creates, so it runs with no caller at
  // all and the address it arrived from is the only thing to throttle on.
  .procedure("register")
  .withFacts(callerAddressFact)
  .withAccess(
    publicRoute({
      reason:
        "the signup form's own backend: it mints the account a caller would otherwise need to already hold",
    }),
  )
  .handle(({ app, input }, callerAddress) =>
    app.registerCredentialAccount({
      name: input.name ?? null,
      email: input.email,
      password: input.password,
      callerAddress: callerAddress ?? "unknown",
    }),
  )

  .procedure("getTraceExplorerTourPreference")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) =>
    app.getTraceExplorerTourPreference({ id: callerOf(actor).operatorId }),
  )

  .procedure("dismissTraceExplorerTour")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) => app.dismissTraceExplorerTour({ id: callerOf(actor).operatorId }))

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

  .procedure("unlinkAccount")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor, input }) => {
    await app.unlinkOwnAccount({ userId: actor.id, accountId: input.accountId });

    return { success: true as const };
  })

  .procedure("passkeyNudge")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(({ app, actor }) => app.getPasskeyOffer({ id: actor.id }))

  .procedure("dismissPasskeyNudge")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor }) => {
    await app.dismissPasskeyNudge({ id: actor.id });

    return { success: true as const };
  })

  .procedure("hasPassword")
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor }) => ({ hasPassword: await app.hasPassword({ id: actor.id }) }))

  // The session row travels as a fact: one person on two tabs is one actor and
  // two sessions, so "end every session but this one" is a question about the
  // request rather than about who asked.
  .procedure("setPassword")
  .withFacts(browserSessionFact)
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor, input }, browserSession) => {
    await app.setOwnFirstPassword({
      userId: actor.id,
      password: input.password,
      keepSessionId: keptSessionOf({ actor, browserSession }),
    });

    return { success: true as const };
  })

  .procedure("changePassword")
  .withFacts(browserSessionFact)
  .noPermission({ reason: OWN_ACCOUNT })
  .handle(async ({ app, actor, input }, browserSession) => {
    await app.changeOwnPassword({
      userId: actor.id,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      keepSessionId: keptSessionOf({ actor, browserSession }),
    });

    return { success: true as const };
  })

  .procedure("deactivate")
  .noPermission({ reason: SELF_OR_OPERATOR })
  .handle(async ({ app, actor, input }) => {
    await app.deactivateAccount({ userId: input.userId, caller: callerOf(actor) });

    return { success: true as const };
  })

  .procedure("reactivate")
  .noPermission({ reason: SELF_OR_OPERATOR })
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

  .procedure("personalContext")
  .withPermission("organization:view")
  .handle(({ app, actor, input }) =>
    app.getPersonalContext({ userId: actor.id, organizationId: input.organizationId }),
  )

  .procedure("personalBudget")
  .withPermission("organization:view")
  .handle(({ app, actor, input }) =>
    app.getPersonalBudget({ userId: actor.id, organizationId: input.organizationId }),
  )

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

/**
 * The session a credential write keeps. Null while an operator is
 * impersonating: the row is the OPERATOR's, so keeping it would neither keep
 * the subject's tab nor mean anything about the subject's devices.
 */
function keptSessionOf({
  actor,
  browserSession,
}: {
  actor: TrpcHandlerActor;
  browserSession: string | null;
}): string | null {
  return callerOf(actor).impersonated ? null : browserSession;
}
