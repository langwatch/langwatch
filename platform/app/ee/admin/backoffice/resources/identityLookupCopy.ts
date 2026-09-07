/**
 * The words and the derivations the operator identity lookup renders.
 *
 * Kept out of the components so the rules a scenario names — an identifier
 * is shortened in its MIDDLE, a repair names the organization by NAME or is
 * not offered at all, a wait is stated in units a person reads — are each
 * one function a test can call rather than a string buried in JSX.
 */

/**
 * A long identifier, shortened in its middle.
 *
 * The middle rather than the tail because both ends carry meaning: the
 * prefix says what kind of thing it is and the suffix is what distinguishes
 * two of them in a log line. Trimming the tail throws away the half an
 * operator is actually comparing.
 */
export function shortenIdentifier(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** How a sign-in method's state reads on screen. */
const STATE_LABEL: Record<string, string> = {
  ATTACHED: "attached, not proved",
  VERIFIED: "proved",
  PRIMARY: "proved, primary",
  DETACHED: "removed",
  DEAD_ENDED: "dead end",
};

export function identifierStateLabel(state: string): string {
  return STATE_LABEL[state] ?? state.replace(/_/g, " ").toLowerCase();
}

/** What each identity fact says happened, in the operator's language. */
const FACT_LABEL: Record<string, string> = {
  "lw.identity.identifier_attached": "Sign-in method attached",
  "lw.identity.identifier_verified": "Sign-in method proved",
  "lw.identity.identifier_dead_ended": "Sign-in method reached a dead end",
  "lw.identity.primary_changed": "Primary sign-in method changed",
  "lw.identity.identifier_detached": "Sign-in method removed",
  "lw.identity.user_erased": "Identity erased",
  "lw.identity.link_proposed": "Sign-in waiting for somebody to confirm it",
  "lw.identity.link_confirmed": "Waiting sign-in confirmed",
  "lw.identity.link_rejected": "Waiting sign-in rejected",
};

export function identityFactLabel(type: string): string {
  return FACT_LABEL[type] ?? type;
}

/** Why a sign-in was handed to a human rather than linked. */
const PROPOSAL_REASON_LABEL: Record<string, string> = {
  unverified_orphan: "the account holding this address has never proved it",
  ambiguous_candidates: "more than one account holds this address",
  unvouched_identifiers:
    "the account also signs in with addresses this organization cannot vouch for",
};

export function proposalReasonLabel(reason: string): string {
  return PROPOSAL_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

/**
 * How long something has been waiting, in the largest unit that still says
 * something. Days for anything over a day, because a queue measured in
 * hours past the second day is a number the reader has to divide.
 */
export function waitedFor({
  sinceMs,
  nowMs,
}: {
  sinceMs: number;
  nowMs: number;
}): string {
  const elapsed = Math.max(0, nowMs - sinceMs);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${plural(minutes, "minute")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")}`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "day")}`;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

/**
 * Whether a repair may be offered against this target at all.
 *
 * The rule is not "does the operator have the right" — that is `canRepair`.
 * It is "can this surface name what the repair would land on". On a
 * cross-organization page the risk is not the wrong action; it is the right
 * action on the wrong tenant, and an operator who has been shown
 * `org_LVYcVYGW1AJq` has not been told anything they can check. So a target
 * whose organization cannot be named is withheld rather than confirmed.
 */
export function repairTargetIsNameable({
  organizationName,
  personName,
}: {
  organizationName: string | null;
  personName: string | null;
}): boolean {
  return Boolean(organizationName) && Boolean(personName);
}

/** The sentence a repair confirmation opens with. */
export function repairConfirmationTitle({
  verb,
  personName,
  organizationName,
}: {
  verb: string;
  personName: string;
  organizationName: string;
}): string {
  return `${verb} for ${personName} at ${organizationName}?`;
}
