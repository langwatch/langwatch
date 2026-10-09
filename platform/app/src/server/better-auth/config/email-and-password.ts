import {
  PASSWORD_MAXIMUM_BYTES,
  PASSWORD_MINIMUM_LENGTH,
  passwordProblem,
} from "@langwatch/identity";
import { compare, hash } from "bcrypt";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { env } from "~/env.mjs";
import { sendResetPasswordEmail } from "../../mailer/resetPasswordEmail";

/**
 * Whether BetterAuth's email/password (credentials) routes are MOUNTED.
 *
 * Three deployments reach true, for three different reasons.
 *
 * Native `email` mode, because credentials are the only way in there.
 *
 * Self-hosted, always, even with an enterprise IdP configured: a deployment
 * the SSO license gate DENIES needs a working coerced email door, and a
 * licensed install keeps password-reset self-recovery reachable (ADR-027).
 *
 * And, since D09, a deployment that opts into issuing its OWN passwords
 * beside its provider — `deploymentIssuesOwnPasswords` below. That is the one
 * that relaxes the old rule, which came from NextAuth: EITHER a social
 * provider OR CredentialsProvider, never both, so nobody could sidestep the
 * configured SSO. It is opt-in and ships off, and the reasoning for it is on
 * that predicate rather than repeated here.
 *
 * MOUNTING IS NOT THE GATE, and that sentence carries more weight now than it
 * used to. The `before` hook is what refuses `/sign-in/email` and
 * `/sign-up/email` — `refusesCredentialRoute` for the deployment, and
 * `refuseConnectionGovernedCredential` for an address whose ORGANIZATION
 * routes it through its own provider, which the mixed mode above must never
 * hand a password to. Reading a mounted route as an open one is how that
 * second refusal would get dropped.
 *
 * Exported for unit testing — lets us assert the credentials gate per provider
 * without re-initializing the module under a different `NEXTAUTH_PROVIDER`.
 */
export const isEmailPasswordEnabled = (
  e: Pick<
    typeof env,
    "NEXTAUTH_PROVIDER" | "IS_SAAS" | "LOCAL_PASSWORDS_ENABLED"
  >,
): boolean =>
  e.NEXTAUTH_PROVIDER === "email" ||
  !e.IS_SAAS ||
  deploymentIssuesOwnPasswords(e);

/**
 * Whether this deployment issues and verifies its own passwords WHILE a
 * federated provider is also configured (D09).
 *
 * The one predicate behind a rule that five sites used to spell separately —
 * the sign-up method set, `user.register`, `user.setPassword`, the
 * credential-route refusal, and the mounting above. Each said "on this
 * deployment, passwords live at the identity provider" as
 * `resolveAuthProvider() === "email"`, and a flip that reached four of the
 * five would leave a door that offers a password nothing will accept, or
 * accepts one nothing offers.
 *
 * Email mode is NOT asked here, and callers must check it first: a
 * deployment in email mode issues its own passwords by definition, whatever
 * this says. This answers only the harder question — whether a deployment
 * that ALSO federates keeps a password door of its own.
 */
export const deploymentIssuesOwnPasswords = (
  e: Pick<typeof env, "LOCAL_PASSWORDS_ENABLED">,
): boolean => e.LOCAL_PASSWORDS_ENABLED === "on";

export interface EmailAndPasswordDeps {
  /**
   * bcrypt's cost for every password that arrives through better-auth's own
   * endpoints. The composition root's number, so the bridge here and the
   * credential service write hashes of the same strength.
   */
  hashRounds: number;
  /** Ending every session the account had before the reset. */
  revokeAllSessions: (args: { userId: string }) => Promise<void>;
  /** Who reset, remembered for the after-hook that opens the new session. */
  recordPasswordReset: (args: { userId: string }) => void;
}

/**
 * The credential configuration, mounted on the answer above.
 *
 * BetterAuth mounts the email/password routes (`/sign-up/email`,
 * `/sign-in/email`) whenever `emailAndPassword.enabled` is set, so the
 * deployment's own answer has to be mirrored here — without it, anyone could
 * POST to `/api/auth/sign-up/email` on an SSO deployment and sidestep the
 * identity provider entirely.
 *
 * Which deployments mount is `isEmailPasswordEnabled`'s docblock: email mode,
 * self-hosted, and — opt-in, shipped off — one that issues its own passwords
 * beside its provider (D09). The old summary of "SaaS never, unless natively
 * in email mode" was true until that third case existed and is no longer the
 * contract.
 *
 * ADR-027's division still holds and is the thing to keep hold of: mounting is
 * NOT the gate. The `before` hook (gate site #3) refuses `/sign-in/email` and
 * `/sign-up/email` when the SSO license gate ALLOWS and the deployment offers
 * no password of its own — the load-bearing guard against minting password
 * accounts on a licensed Auth0/Okta install — and refuses them for an address
 * an organization routes through its own connection whatever the deployment
 * offers. `/sign-up/email` is additionally sealed outright, since local
 * account creation belongs to `user.register` and its mailbox proof.
 */
export function emailAndPassword({
  hashRounds,
  revokeAllSessions,
  recordPasswordReset,
}: EmailAndPasswordDeps): BetterAuthOptions["emailAndPassword"] {
  return {
    enabled: isEmailPasswordEnabled(env),
    /**
     * The policy module's numbers, stated here because BetterAuth enforces
     * its OWN otherwise — and its own were not ours.
     *
     * `passwordProblem` is asked by every form and by the tRPC mutations
     * behind them, but BetterAuth's endpoints (`/sign-up/email`,
     * `/reset-password`) never reach either: they check
     * `emailAndPassword.{min,max}PasswordLength` and nothing else. Unset,
     * those default to 8 and 128, so the minimum agreed by coincidence and
     * the MAXIMUM did not — a 73-to-128 character password was accepted
     * there and then silently truncated at byte 72 by bcrypt, which is
     * exactly what the policy module refuses to let happen.
     */
    minPasswordLength: PASSWORD_MINIMUM_LENGTH,
    // Characters, which is the only unit BetterAuth counts in. It is a
    // coarse cap that cannot express the real rule — 72 BYTES — because a
    // 72-character string of emoji is 288 bytes. The exact rule is enforced
    // at the hash below, which every password write must pass through
    // whichever endpoint it arrived on.
    maxPasswordLength: PASSWORD_MAXIMUM_BYTES,
    password: {
      hash: async (password: string) => {
        // THE CHOKE POINT. Sign-up, reset and change all hash, so asking
        // here is what makes one policy true on every door rather than on
        // the ones that happen to run our own validation first.
        const problem = passwordProblem(password);
        if (problem) {
          // BetterAuth's own code, so the refusal lands on the existing
          // translation (`handled-errors.ts`) and reaches the browser as
          // `identity_password_rejected` with copy from the registry.
          throw new APIError("BAD_REQUEST", {
            code: "PASSWORD_TOO_LONG",
            message: problem,
          });
        }
        return hash(password, hashRounds);
      },
      verify: async ({ password, hash: storedHash }) =>
        compare(password, storedHash),
    },
    /**
     * Reset-link lifetime. Kept at BetterAuth's one-hour default but stated
     * explicitly so the email copy ("this link expires in 1 hour") and the
     * token expiry can't silently drift apart.
     */
    resetPasswordTokenExpiresIn: 60 * 60,
    /**
     * Wires BetterAuth's /request-password-reset endpoint to our existing
     * transactional mailer (SendGrid / SES via `sendEmail`). Without this the
     * endpoint returns RESET_PASSWORD_DISABLED. We ignore BetterAuth's default
     * `url` and build the link off BASE_HOST + the issued token so it lands on
     * our own /auth/reset-password page. Reset is deliberately reachable on a
     * deployment the SSO license gate denies, even with an IdP configured
     * (ADR-027), so that a user whose account was born through that IdP can
     * still recover through their inbox. It closes again once the gate allows.
     */
    sendResetPassword: async ({ user, token }) => {
      await sendResetPasswordEmail({
        email: user.email,
        resetUrl: `${env.BASE_HOST}/auth/reset-password?token=${encodeURIComponent(token)}`,
      });
    },
    /**
     * After a successful reset, force-logout every existing session for the
     * user. The self-service change-password flow revokes *other* sessions
     * (keeping the current tab); here the user isn't signed in, and a reset is
     * the recovery path for a possibly-compromised account, so we revoke all.
     */
    onPasswordReset: async ({ user }) => {
      await revokeAllSessions({ userId: user.id });
      // Password recovery never clears the explicit sign-up latch. A pending
      // row may already hold a credential planted before mailbox proof, and a
      // reset proves only the mailbox, not that the stored passkey or account
      // should become trusted. The session gate keeps that residue closed.
      // Every old session is gone; the after-hook opens the one new session
      // this reset earned, for the device that set the password. Recorded
      // AFTER the revoke so the new session is never among the revoked.
      recordPasswordReset({ userId: user.id });
    },
  };
}
