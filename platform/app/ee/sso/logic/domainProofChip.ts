/**
 * What one domain's chip says, in one place (ADR-123, wave 3).
 *
 * Two surfaces read the same domain state — the access panel, where a reader
 * is auditing who gets in, and single sign-on setup, where an administrator
 * is building the connection. They must not disagree: a domain that says
 * "Record missing" on one screen and "Proved" on the other is a screen that
 * tells somebody their sign-in is fine while the evidence behind it has
 * gone.
 *
 * Framework-free on purpose, so both a settings component and anything that
 * has to reason about the words without rendering them can read the same
 * table.
 */

export type DomainProofState = "VERIFIED" | "WAVERING" | "LAPSED";

export type DomainChipTone = "good" | "warning" | "bad";

export interface DomainChip {
  label: string;
  tone: DomainChipTone;
  /** The longer explanation, on hover. */
  title: string;
}

/** The one thing a reader has to publish, and nothing about who is busy. */
const PUBLISH_IT = "Publish the DNS record and ask us to check for it.";

/**
 * Which chip one domain gets, as a table rather than a ternary staircase.
 *
 * Ordered by what a reader most needs to know: whether the evidence behind a
 * proved domain has gone, then whether it is proved at all, then where an
 * unproved claim stands. A lapsed domain is read before a proved one on
 * purpose — it is still in `verifiedDomains`, because it still routes, and a
 * chip that said "Proved" would be technically true and completely wrong.
 *
 * The waiting case splits on `waitsForReview` for the same kind of reason: a
 * customer whose own record has not landed yet is waiting for THEMSELVES,
 * and telling them we are reviewing it is telling them to sit still when the
 * next move is theirs.
 */
export function domainProofChipFor({
  proved,
  proofState,
  graceEndsAtMs,
  claim,
}: {
  proved: boolean;
  proofState: DomainProofState;
  graceEndsAtMs: number | null;
  claim:
    | { state: "WAITING" | "APPROVED" | "REJECTED"; waitsForReview: boolean }
    | undefined;
}): DomainChip {
  if (proved && proofState === "LAPSED") {
    return {
      label: "Record missing",
      tone: "bad",
      title:
        "We haven't been able to find your record for two days, so this domain no longer lets new people in on its own. Everyone already here signs in as usual — publish the record again and it goes back to normal.",
    };
  }
  if (proved && proofState === "WAVERING") {
    return {
      label: "Record not found",
      tone: "warning",
      title: graceEndsAtMs
        ? `We can't find your record right now. Nothing has changed yet — republish it before ${new Date(graceEndsAtMs).toLocaleString()} and nothing will.`
        : "We can't find your record right now. Nothing has changed yet — republish it and nothing will.",
    };
  }
  if (proved) {
    return {
      label: "Proved",
      tone: "good",
      title:
        "We found the record. This domain routes sign-ins to your identity provider.",
    };
  }
  // The only claim a person is looking at is one on a domain somebody else
  // already proved. Every other waiting claim is waiting for the READER.
  if (claim?.state === "WAITING" && claim.waitsForReview) {
    return {
      label: "Waiting for review",
      tone: "warning",
      title: "We are checking this claim by hand.",
    };
  }
  if (claim?.state === "REJECTED") {
    return {
      label: "Not approved",
      tone: "bad",
      title: "This claim was not approved. You can claim it again.",
    };
  }
  return { label: "Not proved yet", tone: "warning", title: PUBLISH_IT };
}
