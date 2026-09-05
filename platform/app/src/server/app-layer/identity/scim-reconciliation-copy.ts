/**
 * The words a customer reads about their directory sync (ADR-122).
 *
 * A pure module with no reads and no framework, for the reason the error
 * presentation registry is one: what a person reads is a decision, and a
 * decision spread across a page component and a service is a decision two
 * people will make differently. The org surface renders what this returns and
 * writes no sentence of its own.
 *
 * Two rules the spec is explicit about, and this file is where they hold:
 *
 *   NO CODES REACH A CUSTOMER  `TOKEN_ISSUED` is not a status, it is a state
 *                              name. What the reader wants is "waiting for
 *                              its first push", which is the same fact said
 *                              to a person.
 *
 *   NO RETRY IS OFFERED        a failed apply is put right by the directory's
 *                              next push, which re-asserts everything the
 *                              directory still believes. That is D08's
 *                              reactivation-is-re-entry rule doing its job,
 *                              so the remediation copy says so instead of a
 *                              control saying nothing.
 */
import {
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncLifecycleState,
} from "@langwatch/identity";

/** What a connection's sync says about itself, in words. */
export interface ScimSyncStatusCopy {
  /** A short statement of where the sync stands. */
  headline: string;
  /** What it is waiting for, or what it is doing. Never a code. */
  waitingFor: string;
  /**
   * Whether this state is a problem. A connection nobody has pushed to yet
   * is not — it is a setup somebody has not finished, which reads calmly.
   */
  tone: "waiting" | "working" | "attention" | "ended";
}

/**
 * The remediation for every failed apply, and the reason no surface here
 * offers a retry control.
 */
export const DIRECTORY_FAILURE_REMEDIATION =
  "Your identity provider's next push re-asserts everything it still believes, so fixing this in the directory is what puts it right.";

export function scimSyncStatusCopy({
  state,
  hasPushed,
  revokedCause,
}: {
  /** Null for a connection no token has ever been minted against. */
  state: ScimSyncLifecycleState | null;
  hasPushed: boolean;
  revokedCause: "revoke" | "teardown" | null;
}): ScimSyncStatusCopy {
  if (state === null) {
    return {
      headline: "Not set up yet",
      waitingFor:
        "No directory token has been issued for this connection. Issue one and point your identity provider at it to start provisioning.",
      tone: "waiting",
    };
  }
  switch (state) {
    case "TOKEN_ISSUED":
      return {
        headline: "Waiting for the first push",
        waitingFor:
          "The token is ready. Point your identity provider at it and the first push will start the sync.",
        tone: "waiting",
      };
    case "SYNCING":
      return {
        headline: "Syncing",
        waitingFor: hasPushed
          ? "Your identity provider is pushing changes and they are being applied."
          : "Your identity provider is connected and changes are being applied.",
        tone: "working",
      };
    case "ERROR":
      return {
        headline: "Something the directory asked for has not been applied",
        waitingFor: DIRECTORY_FAILURE_REMEDIATION,
        tone: "attention",
      };
    case "REVOKED":
      return {
        headline: "Sync has ended",
        waitingFor:
          revokedCause === "teardown"
            ? "This connection was removed, so the tokens issued for it no longer work."
            : "The token for this connection was revoked, so it no longer provisions anyone.",
        tone: "ended",
      };
  }
}

/**
 * What a directory-caused membership change is called on the customer's
 * surface. The author is always the directory, and saying so is the point:
 * a change nobody in the organization made needs an author a person can name
 * before they go looking for who did it.
 */
export const DIRECTORY_CHANGE_AUTHOR = "Your identity provider";

export function directoryChangeCopy({
  kind,
  person,
}: {
  kind: "attached" | "removed";
  /** The person's name or address, when the change was about one. */
  person: string | null;
}): string {
  const who = person ?? "a group";
  return kind === "removed" ? `${who} lost access` : `${who} was given access`;
}

/**
 * One line of the activity feed (ADR-126).
 *
 * SAID AS THE DIRECTORY'S ACT, not as ours. Every one of these happened
 * because a provider sent something, and the reader is trying to match what
 * they see here against what they did over there — so the sentence names the
 * operation the provider performed, in that vocabulary, rather than the
 * internal state it moved.
 *
 * The person is named where we know them and described where we do not: a
 * push whose user we have not resolved yet is still worth a line, and "a
 * person" beats an identifier the reader has never seen. A failure's words
 * come from the same error registry the failure panel uses, so the two
 * surfaces cannot describe one failure differently.
 */
export const DIRECTORY_ACTIVITY_UNKNOWN_PERSON = "a person";

export function directoryActivityCopy({
  type,
  op,
  person,
  failure,
}: {
  type: string;
  /** The operation the fact names, when it names one. */
  op: string | null;
  /** The person's name or address, when we could resolve them. */
  person: string | null;
  /** The failure's words, already looked up, when this entry is a failure. */
  failure: string | null;
}): string {
  const who = person ?? DIRECTORY_ACTIVITY_UNKNOWN_PERSON;
  switch (type) {
    case SCIM_TOKEN_ISSUED_EVENT_TYPE:
      return "A provisioning token was issued for this connection";
    case SCIM_USER_PUSHED_EVENT_TYPE:
      return `${directoryUserOpCopy(op)} ${who}`;
    case SCIM_GROUP_MAPPED_EVENT_TYPE:
      return "Your directory sent a group";
    case SCIM_APPLY_FAILED_EVENT_TYPE:
      return failure ?? `Something your directory sent could not be applied`;
    case SCIM_APPLY_RECOVERED_EVENT_TYPE:
      return "A change that had been failing went through";
    case SCIM_APPLY_RETIRED_EVENT_TYPE:
      return failure
        ? `${failure} — no longer being retried`
        : "A change your directory sent will not be retried again";
    case SCIM_APPLY_REDRIVEN_EVENT_TYPE:
      return "A change that had been given up on was sent through again";
    case SCIM_TOKEN_REVOKED_EVENT_TYPE:
      return "This connection's provisioning token stopped working";
    default:
      // A fact this surface has no words for is still a fact, and dropping it
      // would make the sequence lie about what happened. It says the least
      // that is true rather than nothing at all.
      return "Your directory did something we have no words for yet";
  }
}

/** The provider's own verb for what it did to somebody. */
function directoryUserOpCopy(op: string | null): string {
  switch (op) {
    case "create":
      return "Your directory added";
    case "update":
      return "Your directory updated";
    case "deactivate":
      return "Your directory switched off access for";
    case "remove":
      return "Your directory removed";
    default:
      return "Your directory sent";
  }
}
