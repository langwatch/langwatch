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
 * On SaaS they mount only in native `email` mode: the original NextAuth code
 * mounted EITHER a social provider OR CredentialsProvider, never both, so
 * users could not bypass the configured SSO. This gate mirrors that invariant.
 *
 * On self-hosted they always mount, even with an enterprise IdP configured,
 * so that a deployment the SSO license gate DENIES has a working coerced email
 * door and a licensed install keeps password-reset self-recovery reachable
 * (ADR-027). Mounting is not the gate: the `before` hook is what blocks
 * `/sign-in/email` and `/sign-up/email` when the gate ALLOWS, which is the
 * load-bearing guard against minting password accounts on a licensed install.
 *
 * Exported for unit testing — lets us assert the credentials gate per provider
 * without re-initializing the module under a different `NEXTAUTH_PROVIDER`.
 */
export const isEmailPasswordEnabled = (
  e: Pick<typeof env, "NEXTAUTH_PROVIDER" | "IS_SAAS">,
): boolean => e.NEXTAUTH_PROVIDER === "email" || !e.IS_SAAS;

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
 * Credentials signin/signup is ONLY enabled in on-prem `email` mode.
 * In cloud / SSO deployments (NEXTAUTH_PROVIDER=auth0/google/github/...)
 * the original NextAuth code added EITHER a social provider OR
 * CredentialsProvider — never both — so users could not bypass the
 * configured SSO. BetterAuth defaults to mounting the email/password
 * routes (`/sign-up/email`, `/sign-in/email`) whenever
 * `emailAndPassword.enabled` is set, so we have to mirror the gate
 * here. Without it, an attacker could POST to `/api/auth/sign-up/email`
 * in cloud mode and bypass Auth0/SSO entirely.
 *
 * ADR-027: on self-hosted (`!IS_SAAS`) the routes are always MOUNTED —
 * even when an enterprise IdP is configured — so a denied (unlicensed)
 * deployment has a working coerced email door and licensed installs keep
 * password-reset self-recovery reachable. Mounting alone is NOT the
 * gate: the `before` hook (gate site #3) is what blocks
 * `/sign-in/email` + `/sign-up/email` when the SSO license gate ALLOWS —
 * that's the load-bearing guard against minting password accounts on a
 * licensed Auth0/Okta install (v5 BLOCKER fix). SaaS is unchanged: routes
 * stay unmounted unless natively in email mode.
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
      // Every old session is gone; the after-hook opens the one new session
      // this reset earned, for the device that set the password. Recorded
      // AFTER the revoke so the new session is never among the revoked.
      recordPasswordReset({ userId: user.id });
    },
  };
}
