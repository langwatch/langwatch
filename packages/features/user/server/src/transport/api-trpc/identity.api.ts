/**
 * The identity surface the app itself calls (D01), over the process's tRPC
 * transport.
 *
 *   completeVerification: spends an email-verification ceremony.
 *
 * tRPC, not a versioned REST family: every operation here acts on the
 * CALLER'S OWN identity, so the credential is the session and the caller is
 * always this app's own frontend. That is the lane the rest of the product
 * uses. The public, versioned, API-key surface is for things outside the
 * app — when SCIM arrives (D08) it brings its own token auth and its own
 * family, and it will not reuse a session.
 *
 * No permission check applies and none is missing: identity is user-scoped,
 * not organization-scoped. The process's authenticated procedure proves the
 * session, and the ceremony service proves the verification record is pinned
 * to exactly that user — so a caller can only ever act on themselves.
 *
 * It lives in the user feature because `packages/features/catalogue.json`
 * names no `identity` feature and this procedure acts on the session user's
 * own record. The identity PLATFORM package (`@langwatch/identity-server`)
 * would be the other candidate and is deliberately not used: it is pinned to
 * Zod 3 while the app's tRPC boundary is Zod 4, and an input parser built
 * from the other major throws a `ZodError` the app's error formatter does not
 * recognise, which degrades a field-level rejection into a 500.
 *
 * Transport only: the ceremony itself is the process's identity runtime,
 * injected as a port.
 *
 * Spec: specs/identity/identifier-model.feature.
 */
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/** The process supplies authentication; authorization arrives as `policy`. */
export type IdentityTrpcContext = Readonly<{
  actor(): Readonly<{ id: string }>;
}>;

type IdentityTrpcProcedures<
  TContext extends IdentityTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The process capabilities this transport needs that are not the user's own. */
export type IdentityTrpcPorts = Readonly<{
  /**
   * The process's verification ceremony. Refuses a record that is not pinned
   * to `userId`, which is what makes the ids in the input safe to accept.
   */
  completeEmailVerification(
    input: Readonly<{
      userId: string;
      identifierId: string;
      verificationId: string;
      token: string;
      codeVerifier: string;
    }>,
  ): Promise<unknown>;
}>;

const completeVerificationInputSchema = z.object({
  identifierId: z.string().min(1),
  verificationId: z.string().min(1),
  token: z.string().min(1),
  // RFC 7636 §4.1: 43-128 characters from the unreserved set.
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

/**
 * ADR-092's contract: every procedure states its permission or why it has
 * none. This one acts on the caller's OWN verification record — there is no
 * organization scope to check. The session proves who they are, and the
 * ceremony service proves the record is pinned to exactly that user, so the
 * input carries no scope a caller could widen.
 */
const OWN_VERIFICATION_RECORD: AuthzDeclaration = {
  kind: "no-permission",
  reason:
    "completes the session user's own email verification; the ceremony service proves the record is pinned to that user, and no organization scope applies",
};

/**
 * Installs the complete `identity.*` tRPC surface on a process-owned root. The
 * procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class IdentityTrpcApi {
  static create<
    TContext extends IdentityTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: IdentityTrpcProcedures<TContext, TOptions, TRoot>,
    ports: IdentityTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * Complete an email verification ceremony. Carries the two proofs that
       * must arrive together: the emailed single-use token, and the PKCE
       * verifier held by the context that STARTED the ceremony. A link opened
       * on its own — forwarded, or followed by a mail scanner — can never
       * verify anything, because it carries only the first.
       */
      completeVerification: policy(OWN_VERIFICATION_RECORD)(
        procedure.input(completeVerificationInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ports.completeEmailVerification({
          userId: ctx.actor().id,
          identifierId: input.identifierId,
          verificationId: input.verificationId,
          token: input.token,
          codeVerifier: input.codeVerifier,
        });
        return { verified: true as const };
      }),
    });
  }
}
