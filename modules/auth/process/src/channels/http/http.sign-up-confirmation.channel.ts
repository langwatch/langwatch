import { frontDoorTokenInputSchema, type SignUpVerificationResult } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import type { UserApi } from "@langwatch/user-contract";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

const logger = createLogger("langwatch:better-auth:sign-up-confirmation");

/** Where the sign-up screen posts a spent link, under the auth base path. */
export const SIGN_UP_CONFIRM_ADDRESS_PATH = "/sign-up/confirm-address";

/** Spending the link: what it confirmed, and whether THIS request was the one that spent it. */
export interface SignUpAddressConfirmation {
  completeVerification(input: {
    token: string;
  }): Promise<Omit<SignUpVerificationResult, "signedIn"> & { freshClaim: boolean }>;
}

/**
 * Spending the emailed sign-up link (ADR-117 §6). A Better Auth endpoint because it may set
 * the first session cookie; a refusal is a thrown handled error. Only a link spent HERE, on an
 * existing account, opens a session. specs/identity/signin-signup-screens.feature
 */
export function signUpConfirmationPlugin({
  verification,
  users,
}: {
  verification: SignUpAddressConfirmation;
  users: Pick<UserApi, "findByEmail">;
}): BetterAuthPlugin {
  return {
    id: "langwatch-sign-up-confirmation",
    endpoints: {
      confirmSignUpAddress: createAuthEndpoint(
        SIGN_UP_CONFIRM_ADDRESS_PATH,
        { method: "POST", body: frontDoorTokenInputSchema },
        async (ctx) => {
          const { freshClaim, ...confirmed } = await verification.completeVerification({
            token: ctx.body.token,
          });
          const signedIn =
            confirmed.accountExists && freshClaim
              ? await openSession({ ctx, users, email: confirmed.email })
              : false;
          const answer: SignUpVerificationResult = { ...confirmed, signedIn };

          return ctx.json(answer);
        },
      ),
    },
  };
}

/**
 * The first session for the account the link confirmed. A session that cannot open does not
 * fail the confirmation: the address IS confirmed and the screen offers the way in. An
 * account holding a second factor gets none here; it signs in and is challenged.
 */
async function openSession({
  ctx,
  users,
  email,
}: {
  ctx: GenericEndpointContext;
  users: Pick<UserApi, "findByEmail">;
  email: string;
}): Promise<boolean> {
  try {
    const profile = await users.findByEmail({ email });
    if (!profile) return false;
    const adapter = ctx.context.internalAdapter;
    const user = await adapter.findUserById(profile.id);
    if (!user || ("twoFactorEnabled" in user && user.twoFactorEnabled === true)) return false;
    const session = await adapter.createSession(user.id);
    await setSessionCookie(ctx, { session, user });
    return true;
  } catch (error) {
    logger.warn(
      { error },
      "the confirmation link confirmed the address but could not open a session; the screen offers the way in instead",
    );
    return false;
  }
}
