import { createHmac } from "node:crypto";
import { normalizeIdentifierValue } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { env } from "~/env.mjs";
import { signUpVerification } from "~/server/app-layer/identity/runtime";
import { prisma } from "~/server/db";
import { createPasskeyUser } from "~/server/users/credential-user";

const logger = createLogger("langwatch:better-auth:passkey-signup");

/**
 * The code the sign-up screen watches for, so an address that already has an
 * account turns the screen into the log-in one rather than reporting a failed
 * ceremony. Refused BEFORE the ceremony, which is why no system prompt opens
 * for it.
 */
export const PASSKEY_SIGNUP_EMAIL_TAKEN = "EMAIL_ALREADY_REGISTERED";

/** The code for an address the endpoint will not accept at all. */
export const PASSKEY_SIGNUP_EMAIL_INVALID = "INVALID_EMAIL";

/**
 * Creating an account WITH a passkey, rather than adding one to an account
 * that already exists (Passkey Central, "New account creation with a
 * passkey").
 *
 * Two things have to be true at once for this to work, and the plugin gives
 * both: the registration ceremony has to run for somebody with no session,
 * and the account has to be created only if the ceremony succeeds.
 *
 * `requireSession: false` buys the first and costs the session middleware on
 * `/passkey/generate-register-options` and `/passkey/verify-registration`,
 * which become PUBLIC. That is the security surface of this file, and there
 * are three answers to it:
 *
 *   - `resolveUser` runs only where there is NO session. The plugin prefers a
 *     session when it finds one, so adding a passkey from account settings is
 *     untouched by any of this and still attributes to the signed-in user.
 *   - an address that already has an account is REFUSED. This is the one that
 *     matters: without it the endpoint would attach a stranger's passkey to
 *     anybody's account by name, which is a total account takeover with no
 *     credential needed. Checked before the ceremony so no prompt opens, and
 *     again after it, because the two calls are a round trip apart.
 *   - the endpoints are rate limited alongside `/sign-up/email`, which is the
 *     thing they are: an unauthenticated way to create an account.
 *
 * Nothing is created by asking for options. An abandoned ceremony leaves a
 * challenge that expires and nothing else — same as the address step, which
 * also costs whoever typed it nothing.
 */

/**
 * The WebAuthn user handle for an address that has no account yet.
 *
 * It has to be SOMETHING: the ceremony writes a handle into the credential
 * before we know the id of a user who does not exist. It is never used to look
 * anybody up — authentication finds the credential by its own id and reads the
 * user from our row — so its only jobs are to be stable and to say nothing.
 *
 * Keyed hash of the address, so it is both: signing up twice for the same
 * address presents the same (rpId, handle) pair and the authenticator replaces
 * its credential rather than accumulating one per attempt, and the handle is
 * not the address written down in a credential store we do not control.
 */
function provisionalHandle(email: string): string {
  return `signup_${createHmac("sha256", env.NEXTAUTH_SECRET)
    .update(email)
    .digest("base64url")
    .slice(0, 32)}`;
}

/** The address the ceremony was started for, or a refusal. */
function requireEmail(context: string | null | undefined): string {
  const email = normalizeIdentifierValue(context ?? "");
  // Deliberately shallow. This is the shape check that keeps junk out of a
  // User row; whether the address RECEIVES mail is settled by the confirmation
  // that follows somebody in, not by a regular expression standing in front of
  // them (ADR-117 §6).
  // An empty string contains no "@" either, so it is refused by the same
  // clause rather than by one of its own.
  if (!email.includes("@") || email.length > 320) {
    throw new APIError("BAD_REQUEST", {
      code: PASSKEY_SIGNUP_EMAIL_INVALID,
      message: "Enter an email address to create an account.",
    });
  }
  return email;
}

async function refuseIfRegistered(email: string): Promise<void> {
  // Case-insensitive for the same reason `user.register` is: rows written
  // before addresses were stored lowercased may carry capitals, and a
  // case-twin beside one is two Users answering for one person.
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!existing) return;

  throw new APIError("BAD_REQUEST", {
    code: PASSKEY_SIGNUP_EMAIL_TAKEN,
    message: "That email already has an account. Log in with it instead.",
  });
}

/**
 * Who the ceremony is for, when nobody is signed in: an address that does not
 * have an account yet, and the handle it will present.
 *
 * `name` and `displayName` are what the credential manager SHOWS — this is the
 * line somebody reads in the system prompt and in their password manager
 * later, so it is the address and not an id.
 */
async function resolveUser({
  context,
}: {
  ctx: GenericEndpointContext;
  context?: string | null | undefined;
}): Promise<{ id: string; name: string; displayName: string }> {
  const email = requireEmail(context);
  await refuseIfRegistered(email);

  return {
    id: provisionalHandle(email),
    name: email,
    displayName: email,
  };
}

/**
 * The ceremony succeeded, so the account is earned: create it, and sign the
 * person in.
 *
 * Both halves happen HERE rather than on the screen, and the session is the
 * reason. `verify-registration` establishes no session of its own — only
 * `verify-authentication` does — so a browser that stopped at the passkey row
 * would be holding a credential for an account it is not signed in to, and the
 * only way in would be a second ceremony: one system prompt to create the
 * passkey, another immediately after to use it. That double prompt is exactly
 * the disorientation the guidance warns about, and it reads as the first one
 * having failed.
 *
 * Returning `userId` is what attaches the passkey to the real account rather
 * than to the provisional handle the challenge was minted with.
 */
async function afterVerification({
  ctx,
  context,
}: {
  ctx: GenericEndpointContext;
  context?: string | null | undefined;
}): Promise<{ userId: string; name: string }> {
  const email = requireEmail(context);
  // Again, because the check in `resolveUser` was one network round trip ago
  // and an account can be created in that window. The unique index on the
  // address is the real backstop; this is the one that answers in words.
  await refuseIfRegistered(email);

  const user = await createPasskeyUser({ prisma, email });

  const session = await ctx.context.internalAdapter.createSession(user.id);
  if (!session) {
    // The account exists and the passkey is about to be written against it, so
    // this is recoverable by signing in with the passkey just created. Said as
    // an error rather than swallowed, because the screen has to stop rather
    // than send somebody onwards into a session they do not have.
    logger.error(
      { userId: user.id },
      "passkey sign-up could not open a session",
    );
    throw new APIError("INTERNAL_SERVER_ERROR", {
      code: "UNABLE_TO_CREATE_SESSION",
      message:
        "Your account was created. Sign in with your passkey to carry on.",
    });
  }
  const created = await ctx.context.internalAdapter.findUserById(user.id);
  if (created) await setSessionCookie(ctx, { session, user: created });

  // The address confirmation follows them in, exactly as it does on the
  // password path (ADR-117 §6, revised). Sent from HERE rather than from the
  // screen because the screen navigates away the moment this returns, and a
  // send that races a navigation is a send that sometimes does not happen.
  //
  // Not awaited and not allowed to fail the ceremony: the account is made and
  // the person is signed in, so a mailer that is down is not theirs to solve
  // on the way through the door. It is recoverable from inside the app.
  void signUpVerification()
    .requestVerification({ email })
    .catch((failure: unknown) => {
      logger.warn(
        { error: failure, userId: user.id },
        "passkey sign-up could not send the address confirmation",
      );
    });

  return {
    userId: user.id,
    // The stored label, where the browser did not supply one. The address is
    // what somebody scanning a list of passkeys recognises.
    name: email,
  };
}

/**
 * The plugin's `registration` block. Exported whole so the flag that mounts
 * the plugin is the only thing deciding whether any of it exists.
 */
export const passkeySignUpRegistration = {
  requireSession: false,
  resolveUser,
  afterVerification,
};
