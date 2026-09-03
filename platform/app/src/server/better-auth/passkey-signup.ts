import { createHmac } from "node:crypto";
import { normalizeIdentifierValue } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { GenericEndpointContext } from "better-auth";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { env } from "~/env.mjs";
import { passkeySignUp } from "~/server/app-layer/identity/runtime";
import {
  belongsToSomebody,
  PasskeySignUpAddressTakenError,
} from "~/server/users/credential-user";

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
 * Everything the taken-address guard has to weigh about one row: who it is,
 * and every credential that could sign into it. Both credential tables,
 * because a user whose backfill has finalized keeps theirs on the identity
 * branch and a check seeing only one would call them unregistered.
 */
export interface PasskeySignUpAddressHolder {
  id: string;
  accounts: { provider: string; password: string | null }[];
  accountCredentials: { provider: string; password: string | null }[];
  passkeys: { id: string }[];
  orgMemberships: { organizationId: string }[];
}

/** Who, if anybody, holds an address, and what they can sign in with. */
export interface PasskeySignUpDirectoryPort {
  findAddressHolder(args: {
    email: string;
  }): Promise<PasskeySignUpAddressHolder | null>;
}

/** Writing the account a completed ceremony earned. */
export interface PasskeySignUpAccountsPort {
  createPasskeyUser(args: {
    email: string;
  }): Promise<{ id: string; created: boolean }>;
}

/** The address confirmation that follows a new account in. */
export interface PasskeySignUpVerificationPort {
  requestVerification(args: { email: string }): Promise<void>;
}

export interface PasskeySignUpRegistrationDeps {
  directory: PasskeySignUpDirectoryPort;
  accounts: PasskeySignUpAccountsPort;
  verification: PasskeySignUpVerificationPort;
}

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

/** The one refusal an address that is somebody's answers with. */
function addressIsTaken(): APIError {
  return new APIError("BAD_REQUEST", {
    code: PASSKEY_SIGNUP_EMAIL_TAKEN,
    message: "That email already has an account. Log in with it instead.",
  });
}

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
 *   - `resolveUser` runs only where there is NO session, because the plugin
 *     prefers a session when it finds one. `afterVerification` is NOT the
 *     same: the plugin runs it whichever way the user was resolved, so it has
 *     to recognise a signed-in caller itself and hand the credential to them.
 *     It does. Adding a passkey from account settings therefore still
 *     attributes to the signed-in user — by that branch, not by this one.
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
export class PasskeySignUpRegistration {
  constructor(private readonly deps: PasskeySignUpRegistrationDeps) {}

  /**
   * Who the ceremony is for, when nobody is signed in: an address that does
   * not have an account yet, and the handle it will present.
   *
   * `name` and `displayName` are what the credential manager SHOWS — this is
   * the line somebody reads in the system prompt and in their password manager
   * later, so it is the address and not an id.
   */
  async resolveUser({
    context,
  }: {
    ctx: GenericEndpointContext;
    context?: string | null | undefined;
  }): Promise<{ id: string; name: string; displayName: string }> {
    const email = requireEmail(context);
    await this.refuseIfRegistered(email);

    return {
      id: provisionalHandle(email),
      name: email,
      displayName: email,
    };
  }

  /**
   * The ceremony succeeded, so the account is earned: create it, and hand its
   * id back for the passkey to be written against.
   *
   * Returning `userId` is what attaches the passkey to the real account rather
   * than to the provisional handle the challenge was minted with.
   *
   * The SESSION is not opened here. The client asks for it with
   * `createSession: true`, and the plugin then runs this callback, the passkey
   * write and the session mint inside ONE transaction — so a failure at any of
   * the three leaves no account, no orphan credential and no half-open door.
   * Opening it by hand from this callback (which is what this did before
   * better-auth 1.7) made those three separate writes with nothing spanning
   * them. The session is what makes passkey sign-up a single ceremony: without
   * it the browser would hold a credential for an account it is not signed in
   * to, and the way in would be a second system prompt straight after the
   * first, which reads as the first one having failed.
   */
  async afterVerification({
    ctx,
    context,
  }: {
    ctx: GenericEndpointContext;
    context?: string | null | undefined;
  }): Promise<{ userId: string; name: string }> {
    // ADDING a passkey to an account that already exists, which is what the
    // settings page does, and what the nudge and the post-reset offer do.
    //
    // The plugin resolves the user from the session when it finds one, but it
    // runs this callback either way — there is no branch in it that skips the
    // sign-up hook for a signed-in caller. So without this line a reader who is
    // already signed in falls into the SIGN-UP path below, which reads a
    // `context` the settings page has no reason to send and refuses the
    // ceremony they just completed with "Enter an email address to create an
    // account". Worse than the message: with an address in hand it would go on
    // to create a SECOND account for somebody who is already signed into one.
    //
    // Handing back the session's own user id attaches the credential to them.
    // The plugin compares that id against the session immediately after, so
    // this can only ever name the account the caller already holds.
    const session = await getSessionFromCtx(ctx);
    if (session?.user?.id) {
      return { userId: session.user.id, name: session.user.email };
    }

    const email = requireEmail(context);
    // Again, because the check in `resolveUser` was one network round trip ago
    // and an account can be created in that window. This is the one that
    // answers in WORDS; the decision that actually holds is taken inside the
    // write's own transaction, which is the only place a read of the account
    // and the write that depends on it cannot be separated.
    await this.refuseIfRegistered(email);

    const user = await this.deps.accounts
      .createPasskeyUser({ email })
      .catch((error: unknown) => {
        // The transaction found what the guard above could not: the address
        // became somebody's in between. Same refusal, same code, so the screen
        // cannot tell the two moments apart and does not have to.
        if (error instanceof PasskeySignUpAddressTakenError) {
          logger.warn(
            { path: "/passkey/verify-registration" },
            "an address was claimed between the sign-up guard and the write; the ceremony is refused",
          );
          throw addressIsTaken();
        }
        throw error;
      });

    // The address confirmation follows them in, exactly as it does on the
    // password path (ADR-117 §6, revised). Sent from HERE rather than from the
    // screen because the screen navigates away the moment this returns, and a
    // send that races a navigation is a send that sometimes does not happen.
    //
    // Not awaited and not allowed to fail the ceremony: the account is made and
    // the person is signed in, so a mailer that is down is not theirs to solve
    // on the way through the door. It is recoverable from inside the app.
    //
    // It can outlive a transaction that then rolls back, in which case a link
    // arrives for an address with no account behind it. That link does not
    // break anything — it confirms an address, finds nothing to mark, and lands
    // on the same "pick a way in" step an unspent link always lands on.
    void this.deps.verification
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
   * Whether this address already has an account somebody can sign into.
   *
   * NOT "is there a User row", and the difference is the dead end this closes.
   * A passkey sign-up is TWO calls a network round trip apart — `resolveUser`
   * before the ceremony, `afterVerification` after it — and the account is
   * written between them, in a transaction of its own that nothing spanning the
   * ceremony can roll back. A failure after that write leaves a User row whose
   * only credential is the null-password placeholder, with no passkey beside
   * it: an account with no way in, that nobody has ever signed into. Reading
   * "a row exists" as "registered" turned that residue into a permanent
   * refusal — sign-up said the address was taken while the sign-in screen told
   * the same person no account existed. Neither answer was wrong. They were
   * answering different questions, and only one of them is the question the
   * caller can act on.
   *
   * So this asks that one: is there a CREDENTIAL here. Both branches are read,
   * because a user whose backfill has finalized keeps theirs in
   * `AccountCredential` rather than `Account`, and a check that saw only one
   * would refuse half the population for the wrong reason.
   *
   * ## Why this does not widen the takeover surface
   *
   * The guard above exists to stop a stranger attaching their passkey to
   * somebody else's account by naming its address. It still does. Every account
   * anybody can reach holds a credential by definition, so every account worth
   * stealing is still refused; what became adoptable is only an account that
   * has never been signed into and never could be.
   *
   * That set is exactly this file's own residue, which is what makes the
   * relaxation safe rather than merely convenient. Nothing else in the product
   * makes a credential-less user: `createCredentialUser` always writes a
   * password, a social sign-up always writes its provider's account, an
   * invitation creates no User row at all (`OrganizationInvite` is keyed by
   * address and redeemed after sign-in), and removing somebody's last way in is
   * refused before it happens — by the detach guard on `account.delete.before`,
   * and by `last-way-in.ts` for the passkey and second-factor doors those hooks
   * never saw (ADR-119).
   *
   * MEMBERSHIP IS CHECKED ANYWAY, and the reason is worth stating: everything
   * in the paragraph above is an argument about OTHER code, and this predicate
   * is the security boundary. An account that belongs to an organization is
   * somebody's whatever its credential rows say, so it is refused on that
   * ground alone — which keeps the boundary true even if some later
   * provisioning path starts pre-creating members. It costs no genuine
   * recovery: residue from a ceremony that never finished has no membership,
   * because joining one takes a sign-in and this account has never had a way
   * to sign in.
   */
  private async refuseIfRegistered(email: string): Promise<void> {
    const existing = await this.deps.directory.findAddressHolder({ email });
    if (!existing) return;

    if (!belongsToSomebody(existing)) {
      // The recovery, and the one line that says it happened. Without it a
      // resumed sign-up is indistinguishable from a first one in the logs,
      // which is the difference between knowing this path is exercised and
      // guessing at it from a support ticket.
      logger.info(
        { userId: existing.id },
        "an address whose account holds no credential is being resumed rather than refused; an earlier ceremony did not finish",
      );
      return;
    }

    throw addressIsTaken();
  }
}

/**
 * The plugin's `registration` block. Exported whole so the flag that mounts
 * the plugin is the only thing deciding whether any of it exists.
 */
export const passkeySignUpRegistration = {
  requireSession: false,
  resolveUser: (args: {
    ctx: GenericEndpointContext;
    context?: string | null | undefined;
  }) => passkeySignUp().resolveUser(args),
  afterVerification: (args: {
    ctx: GenericEndpointContext;
    context?: string | null | undefined;
  }) => passkeySignUp().afterVerification(args),
};
