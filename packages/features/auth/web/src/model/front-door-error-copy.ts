/**
 * The words a customer reads for the codes the FRONT DOOR raises.
 *
 * Harvested verbatim from `platform/app/src/features/errors/logic/presentation.ts`
 * — the same titles and the same `describe` bodies, comments included — for the
 * thirty-three codes reachable from a signed-out screen: the invitation
 * refusals, the identity ceremonies, joining an organization, and the four
 * generic ones every surface can meet.
 *
 * A RESTATEMENT, AND IT SAYS SO. The full registry is ~90 codes and 3,700
 * lines of the whole product's error copy; it has no package of its own yet
 * (the manifests have owed the harvest since the governance family) and a
 * feature-web package may not import `platform/app`. Copying the WHOLE thing
 * into one feature would be worse than copying the part that is this feature's
 * own subject — which is what this is. The obligation is the one
 * `@langwatch/enterprise-billing-contract` states about its Prisma enum copies
 * and the data-governance contracts state about their snapshots: these entries
 * and the registry's must stay aligned, and both die into one when the harvest
 * lands.
 *
 * Installed as the DEFAULT explainer, so a composition that installs nothing
 * still reads the right words; `installAuthErrorExplainer` replaces it, which
 * is how the application hands over the full registry once there is one.
 */

import { safeProse, type AuthHandledError } from "./read-handled-error";

/** One entry, exactly as the registry writes one. */
type FrontDoorErrorEntry = {
  title: string;
  describe?: (error: AuthHandledError) => string;
};

/**
 * Reads a string out of `meta` without trusting it. `meta` crosses a wire, so
 * an absent or wrongly-typed value has to read as the fallback.
 */
const str = (error: AuthHandledError, key: string, fallback: string): string => {
  const value = error.meta[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
};

/**
 * Reads a number out of `meta` without trusting it, so a value that arrives as
 * a string or NaN reads as absent rather than reaching a sentence as "NaN".
 */
const num = (error: AuthHandledError, key: string, fallback: number): number => {
  const value = error.meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

/**
 * Reads a list of short identifiers out of `meta` without trusting it.
 * Bounded on both axes because the sentence these end up in is read by a
 * person: a long list stops being copy and becomes a dump.
 */
const strList = (error: AuthHandledError, key: string): string[] => {
  const value = error.meta[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => entry.length > 0 && entry.length <= 64)
    .slice(0, 10);
};

export const FRONT_DOOR_ERROR_COPY: Readonly<Record<string, FrontDoorErrorEntry>> = {
  email_already_registered: {
    // Reached from the sign-up screen, and the reader there is usually looking
    // at their own account: either a previous sign-up created it and could not
    // sign them in, or they were a member before and an invite asked them to
    // create an account they already have. The screen retries the sign-in for
    // them first, so by the time this copy renders the password they typed was
    // not the account's, which leaves exactly two moves worth naming.
    title: "That email already has an account",
    describe: () => "Sign in with it, or reset the password if you don't have it.",
  },

  invite_expired: {
    title: "This invitation has expired",
    describe: () => "Ask for a fresh one and whoever invited you can send it in one click.",
  },

  invite_not_found: {
    title: "Invite not found",
    describe: () =>
      "It may have been revoked or already accepted. Reload to see the pending invites.",
  },

  invite_throttled: {
    title: "That was just sent",
    describe: (error) => {
      const seconds = num(error, "retryAfterSeconds", 0);
      const minutes = Math.ceil(seconds / 60);
      return seconds > 0
        ? `Check the inbox — including spam — and try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
        : "Check the inbox — including spam — before sending another.";
    },
  },

  invite_wrong_account: {
    title: "You're signed in as a different account",
    describe: (error) => {
      const hint = str(error, "invitedHint", "");
      return hint
        ? `This invitation was sent to ${hint}. Sign out and sign back in as that account to accept it.`
        : "Sign out and sign back in as the account this invitation was sent to.";
    },
  },

  identity_email_in_use: {
    title: "That email address is already in use",
    describe: () =>
      "Another account already holds it. Sign in with that account, or use a different address here.",
  },

  identity_engine_unavailable: {
    title: "We couldn't finish creating your account",
    describe: () =>
      "Nothing was created, and we've been alerted. Try again in a moment, and contact support if it keeps happening.",
  },

  identity_identifier_not_found: {
    title: "That sign-in method is no longer on your account",
    describe: () => "Refresh the page to see your current sign-in methods, then try again.",
  },

  identity_identifier_not_verifiable: {
    title: "That sign-in method can't be verified right now",
    describe: () =>
      "It is already verified, or it was removed. Refresh the page to see its current state.",
  },

  identity_jit_disabled: {
    title: "This workspace does not create accounts automatically",
    describe: () => "Ask a workspace administrator to invite you, then sign in again.",
  },

  identity_link_proposed: {
    title: "An administrator needs to confirm this sign-in",
    // Deliberately says nothing about whether an account exists, who holds the
    // address, or what the evidence was. This is answered to whoever arrived,
    // and that is not necessarily the owner of the address.
    describe: () =>
      "Your workspace administrator has been asked to confirm it. Try again once they have.",
  },

  identity_mfa_backup_codes_exhausted: {
    title: "You've used every backup code",
    describe: () =>
      "Sign in with your authenticator app and generate a new set, or ask an administrator to reset two-step verification for you.",
  },

  identity_mfa_code_invalid: {
    // Deliberately says nothing about whether two-step verification is even
    // set up on this account. A wrong code and a code for an enrollment
    // nobody holds read identically here, on purpose.
    title: "That code didn't work",
    describe: () => "Check your authenticator app for the current code and enter it again.",
  },

  identity_mfa_enrollment_expired: {
    title: "That setup took too long",
    describe: () => "Start setting up two-step verification again, and scan the new code.",
  },

  identity_mfa_enrollment_required: {
    // Not an authentication failure: nobody is signed out and every other
    // organization still works. The copy has to make that obvious, or people
    // read it as a session problem and try signing in again.
    title: "This organization requires two-step verification",
    describe: () =>
      "Set up two-step verification to continue here. You're still signed in, and your other organizations are unaffected.",
  },

  identity_mfa_locked_out: {
    title: "Too many incorrect codes",
    describe: () =>
      "Wait a few minutes and try again. If you've lost your authenticator, use a backup code or ask an administrator to reset it.",
  },

  identity_mfa_required_by_organization: {
    title: "An organization you belong to requires two-step verification",
    describe: () =>
      "You can't turn it off while you're a member. Ask an administrator to lift the requirement, or leave the organization first.",
  },

  identity_passkey_ceremony_failed: {
    title: "That passkey attempt didn't finish",
    describe: () =>
      "It may have been cancelled or timed out. Try again, or use another way to sign in.",
  },

  identity_passkey_not_recognized: {
    // Same answer whether the credential belongs to somebody else or to
    // nobody: this endpoint does not tell callers which passkeys exist.
    title: "We couldn't use that passkey",
    describe: () =>
      "Try again, or sign in another way and check which passkeys are on your account.",
  },

  identity_verification_expired: {
    title: "That verification link has expired",
    describe: () => "Request a new verification email and use the newest link.",
  },

  identity_verification_invalid: {
    title: "That verification link didn't work",
    describe: () =>
      "Open the newest verification email and finish confirming from the place where you requested it.",
  },

  join_auto_connection_admits: {
    title: "Your identity provider already admits that domain",
    describe: () =>
      "People on it sign in through single sign-on, so there is nothing for automatic joining to add.",
  },

  join_auto_domain_unproven: {
    title: "That domain is not proven yet",
    describe: () =>
      "Automatic joining works for company domains that at least two of your members have verified. Personal email domains are never eligible.",
  },

  join_auto_not_licensed: {
    title: "Automatic joining needs a licence",
    describe: () =>
      "Colleagues can still ask to join and you approve them. To let them in without asking, add a licence.",
  },

  join_not_available: {
    title: "Nothing to join with this address",
    describe: () =>
      "If you expected to find your team here, ask a colleague to send you an invitation.",
  },

  join_request_already_pending: {
    title: "You have already asked",
    describe: () =>
      "Your request is waiting for an administrator. You will get an email either way.",
  },

  join_request_not_found: {
    title: "That request is no longer there",
    describe: () =>
      "It may have been answered or withdrawn already. Refresh to see what is waiting now.",
  },

  join_request_not_pending: {
    title: "That request was already answered",
    describe: () => "Somebody approved, rejected or withdrew it. Refresh to see where it ended up.",
  },

  join_request_throttled: {
    title: "Give it a moment",
    describe: (error) => {
      const seconds = num(error, "retryAfterSeconds", 0);
      if (seconds <= 0) return "Try that again shortly.";
      const days = Math.ceil(seconds / 86400);
      if (seconds >= 86400) {
        return `Try again in ${days} ${days === 1 ? "day" : "days"}.`;
      }
      const minutes = Math.ceil(seconds / 60);
      return `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    },
  },

  rate_limited: {
    title: "Too many requests",
    describe: () => "Slow down for a moment, then try again.",
  },

  unauthorized: {
    title: "You're not signed in",
    describe: () => "Sign in again to continue.",
  },

  validation_error: {
    title: "Check your input",
    describe: (error) => {
      // The registry's entry names the offending fields through a product-wide
      // label map (`USER_VISIBLE_FIELDS`) that lives with it and covers every
      // surface; it did not travel, because a front-door form is the one place
      // the per-field detail already has a better home — `meta.fieldErrors`
      // goes onto the fields themselves through `applyHandledErrorToForm`, and
      // the alert above the form only has to say the submission was rejected.
      // Field NAMES are deliberately not printed here: they are the input
      // schema's wire identifiers, which is what the label map existed to hide.
      const formErrors = error.meta.formErrors;
      if (Array.isArray(formErrors)) {
        const first = formErrors.find((entry): entry is string => typeof entry === "string");
        if (first) return safeProse(first);
      }
      return "Some of the values aren't valid.";
    },
  },

  not_found: {
    title: "Not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
};

/** The copy for a code the front door knows, or `null` for one it does not. */
export function frontDoorErrorCopy(
  error: AuthHandledError,
): { title: string; description?: string } | null {
  const entry = FRONT_DOOR_ERROR_COPY[error.code];
  if (!entry) return null;
  const description = entry.describe?.(error);
  return description ? { title: entry.title, description } : { title: entry.title };
}
