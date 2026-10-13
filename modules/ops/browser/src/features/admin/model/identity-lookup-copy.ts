import type { LookupOperatorActivityRow } from "@langwatch/identity-contract";

/**
 * The words and derivations the operator identity lookup renders.
 * Spec: specs/identity/platform-ops-identity-lookup.feature.
 */

/** A long identifier, shortened in its middle: the prefix names the kind, the suffix
 *  tells two apart. */
export function shortenIdentifier(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

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

const PROPOSAL_REASON_LABEL: Record<string, string> = {
  unverified_orphan: "the account holding this address has never proved it",
  ambiguous_candidates: "more than one account holds this address",
  unvouched_identifiers:
    "the account also signs in with addresses this organization cannot vouch for",
};

export function proposalReasonLabel(reason: string): string {
  return PROPOSAL_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

/** How long something has waited, in the largest unit that still says something. */
export function waitedFor({ sinceMs, nowMs }: { sinceMs: number; nowMs: number }): string {
  const elapsed = Math.max(0, nowMs - sinceMs);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${plural({ count: minutes, noun: "minute" })}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural({ count: hours, noun: "hour" })}`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural({ count: days, noun: "day" })}`;
}

function plural({ count, noun }: { count: number; noun: string }): string {
  return count === 1 ? noun : `${noun}s`;
}

/** A repair is offered only against a target this surface can name: the risk is the
 *  right act on the wrong tenant. */
export function repairTargetIsNameable({
  organizationName,
  personName,
}: {
  organizationName: string | null;
  personName: string | null;
}): boolean {
  return Boolean(organizationName) && Boolean(personName);
}

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

const OPERATOR_ACTIVITY_LABEL: Record<string, string> = {
  claimQueue: "reviewed domain claims",
  recentActivity: "viewed operator activity",
  endSessions: "ended sessions",
  resolve: "looked up an address",
  person: "viewed a person",
  detachMethod: "removed a sign-in method",
  confirmProposedSignIn: "confirmed a proposed sign-in",
  rejectProposedSignIn: "rejected a proposed sign-in",
  resendInvitation: "resent an invitation",
  extendInvitation: "extended an invitation",
};

export function operatorActivityLabel(act: string): string {
  const operation = act.split(".").at(-1) ?? act;
  return (
    OPERATOR_ACTIVITY_LABEL[operation] ??
    operation
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]/g, " ")
      .toLowerCase()
  );
}

/** Repeated reads share a row and count; distinct repair records remain visible. */
export function summarizeOperatorActivity(activities: readonly LookupOperatorActivityRow[]) {
  const seenIds = new Set<string>();
  const reads = new Set(["claimQueue", "recentActivity", "resolve", "person"]);
  const groups = new Map<string, { activity: LookupOperatorActivityRow; count: number }>();
  for (const activity of activities.toSorted((left, right) => right.atMs - left.atMs)) {
    if (seenIds.has(activity.auditId)) continue;
    seenIds.add(activity.auditId);
    const operation = activity.act.split(".").at(-1) ?? activity.act;
    const key = reads.has(operation)
      ? JSON.stringify([
          activity.operatorUserId,
          activity.act,
          activity.address,
          Math.floor(activity.atMs / 60_000),
        ])
      : activity.auditId;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { activity, count: 1 });
  }
  return [...groups.values()];
}
