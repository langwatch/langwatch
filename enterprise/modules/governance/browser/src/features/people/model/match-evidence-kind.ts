// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * How a link was proved, as the People table's status column needs to say it.
 *
 * A WEB-SIDE COPY of the vocabulary declared in `enterprise/packages/
 * composition/api/src/governance/logic/identityEvidence.ts` (ADR-128 §12,
 * §22). That file is pure by its own admission but lives in the api
 * composition root, which a web package may not value-import
 * (frontend-boundary.unit.test.ts) — so only the enum this table reads is
 * copied here rather than reached across the boundary. `MATCH_SUSPENSION_REASON`
 * and the matching logic stay server-side; nothing here decides a match, it
 * only names one that already happened.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 */
export const MATCH_EVIDENCE_KIND = {
  /**
   * An address the account holder confirmed, equal to one the provider sent.
   * The primary evidence, and the only kind that opens a link by itself.
   */
  VERIFIED_EMAIL: "verified_email",
  /**
   * The same, plus the identity provider's own identifier for that person
   * agreeing with it.
   */
  VERIFIED_EMAIL_AND_DIRECTORY_ID: "verified_email_and_directory_id",
  /** The identity provider's identifier alone. */
  DIRECTORY_ID: "directory_id",
  /** A person looked at a suggestion and said yes. */
  HUMAN_CONFIRMED: "human_confirmed",
} as const;

export type MatchEvidenceKind =
  (typeof MATCH_EVIDENCE_KIND)[keyof typeof MATCH_EVIDENCE_KIND];
