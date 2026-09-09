/**
 * The server half of `emailSuppression.*` (ADR-031): two audiences on one
 * namespace. The unsubscribe pair is public and throttled per caller address by
 * the application; the operator pair is gated on the automation permissions,
 * and its list read is audited because it reads customer email addresses.
 */
import { publicRoute } from "@langwatch/api/access";
import { callerAddressFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { AutomationApi, emailSuppressionTrpc } from "@langwatch/automation-contract";

/** Why the unsubscribe pair opens without a credential. */
const TOKEN_IS_THE_AUTHORIZATION =
  "the unsubscribe link arrives in a mail client where no session exists; the single-purpose " +
  "token in it, whose HMAC binds it to one recipient, is the whole authorization";

export const emailSuppressionTrpcTransport = defineTrpcRouter(AutomationApi, emailSuppressionTrpc)
  /**
   * Public token resolution for the `/unsubscribe` page. Answers the masked
   * address plus the project and automation names, and refuses an invalid,
   * tampered or orphaned token with the one code both halves share.
   */
  .procedure("resolveUnsubscribeToken")
  .withFacts(callerAddressFact)
  .withAccess(publicRoute({ reason: TOKEN_IS_THE_AUTHORIZATION }))
  .handle(({ app, input }, callerAddress) =>
    app.resolveUnsubscribeView({ token: input.token, callerAddress }),
  )

  /** Public button confirm. Idempotent - the suppression upsert collapses duplicates. */
  .procedure("confirmUnsubscribe")
  .withFacts(callerAddressFact)
  .withAccess(publicRoute({ reason: TOKEN_IS_THE_AUTHORIZATION }))
  .handle(async ({ app, input }, callerAddress) => {
    await app.acceptUnsubscribe({
      token: input.token,
      scope: input.scope,
      callerAddress,
      via: "link",
    });

    return { ok: true };
  })

  /**
   * The operator-facing suppression list. Each row carries its automation's
   * name - a null `triggerId` is project-wide - so the table renders the scope
   * without a second round trip.
   */
  .procedure("getAll")
  .withPermission("triggers:view")
  .handle(({ app, input, actor }) =>
    app.listSuppressions({ projectId: input.projectId, actorId: actor.id }),
  )

  /** Removing a suppression resumes delivery - a deliberate operator action. */
  .procedure("remove")
  .withPermission("triggers:manage")
  .handle(async ({ app, input }) => {
    await app.removeSuppression({ projectId: input.projectId, id: input.id });

    return { ok: true };
  })
  .build();
