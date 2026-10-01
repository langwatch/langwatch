// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The row's `evidenceKind`: why a link is believed, never a score (ADR-128 §12). */
export const MATCH_EVIDENCE_KIND = {
  VERIFIED_EMAIL: "verified_email",
  VERIFIED_EMAIL_AND_DIRECTORY_ID: "verified_email_and_directory_id",
  DIRECTORY_ID: "directory_id",
  HUMAN_CONFIRMED: "human_confirmed",
} as const;

export type MatchEvidenceKind = (typeof MATCH_EVIDENCE_KIND)[keyof typeof MATCH_EVIDENCE_KIND];

/** Why automatic linking halted for a person; stored on the person so a recompute cannot clear it. */
export const MATCH_SUSPENSION_REASON = {
  AMBIGUOUS_EMAIL: "ambiguous_verified_email",
  DIRECTORY_DISAGREES: "directory_disagrees_with_email",
  CONTRADICTS_OPEN_LINK: "contradicts_open_link",
} as const;

export type MatchSuspensionReason =
  (typeof MATCH_SUSPENSION_REASON)[keyof typeof MATCH_SUSPENSION_REASON];

export interface DiscoveredIdentity {
  rawActorId: string;
  displayText: string;
  openLinkUserId?: string | null;
}

/** The organization's members, keyed the two ways provider evidence arrives. */
export interface OrganizationAccountIndex {
  usersByVerifiedEmail: ReadonlyMap<string, readonly string[]>;
  usersByDirectoryId: ReadonlyMap<string, readonly string[]>;
}

export interface AutoLinkDecision {
  outcome: "link";
  userId: string;
  evidenceKind: MatchEvidenceKind;
}

export interface SuspendDecision {
  outcome: "suspend";
  reason: MatchSuspensionReason;
  candidateUserIds: string[];
}

export interface NoActionDecision {
  outcome: "no_action";
}

export type MatchDecision = AutoLinkDecision | SuspendDecision | NoActionDecision;

/** A bare address, lowercased and trimmed; anything else (a display form, an opaque id) is none. */
export function normalizeEmail(text: string): string | null {
  const trimmed = text.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function lookup(index: ReadonlyMap<string, readonly string[]>, key: string | null): string[] {
  if (key === null) return [];
  return [...new Set(index.get(key) ?? [])];
}

/**
 * Proof links, contradiction halts, and a directory identifier never stands alone (ADR-128 §12).
 * Spec: specs/governance/governance-identity-match-engine.feature
 */
export function decideMatch({
  identity,
  accounts,
}: {
  identity: DiscoveredIdentity;
  accounts: OrganizationAccountIndex;
}): MatchDecision {
  const emailCandidates = [
    ...new Set(
      [normalizeEmail(identity.rawActorId), normalizeEmail(identity.displayText)].flatMap((key) =>
        lookup(accounts.usersByVerifiedEmail, key),
      ),
    ),
  ];

  if (emailCandidates.length > 1) {
    return {
      outcome: "suspend",
      reason: MATCH_SUSPENSION_REASON.AMBIGUOUS_EMAIL,
      candidateUserIds: emailCandidates,
    };
  }

  const directoryCandidates = [
    ...new Set(
      [identity.rawActorId, identity.displayText].flatMap((key) =>
        lookup(accounts.usersByDirectoryId, key),
      ),
    ),
  ];

  const [emailUserId] = emailCandidates;
  if (emailUserId === undefined) return { outcome: "no_action" };

  if (directoryCandidates.length > 0 && !directoryCandidates.includes(emailUserId)) {
    return {
      outcome: "suspend",
      reason: MATCH_SUSPENSION_REASON.DIRECTORY_DISAGREES,
      candidateUserIds: [...new Set([emailUserId, ...directoryCandidates])],
    };
  }

  const openLinkUserId = identity.openLinkUserId ?? null;
  if (openLinkUserId !== null) {
    if (openLinkUserId === emailUserId) return { outcome: "no_action" };
    return {
      outcome: "suspend",
      reason: MATCH_SUSPENSION_REASON.CONTRADICTS_OPEN_LINK,
      candidateUserIds: [openLinkUserId, emailUserId],
    };
  }

  return {
    outcome: "link",
    userId: emailUserId,
    evidenceKind: directoryCandidates.includes(emailUserId)
      ? MATCH_EVIDENCE_KIND.VERIFIED_EMAIL_AND_DIRECTORY_ID
      : MATCH_EVIDENCE_KIND.VERIFIED_EMAIL,
  };
}
