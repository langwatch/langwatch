import type { AgentSlug } from "@langwatch/contracts/agent-onboarding";

/**
 * One CLI → browser round-trip.
 *
 * Short-lived and keyed by a hash of the handoff code, so the plaintext code
 * that travels in the URL is not sitting in the store next to the account it
 * unlocks. The verifier is never here — only the challenge it must hash to.
 */
export interface ClaimHandoff {
  accountId: string;
  /** Shown on both sides so a human can confirm they match. */
  userCode: string;
  /** RFC 7636 S256 challenge. The verifier is never stored. */
  codeChallenge: string;
  /** Denormalised for the browser page, which must not read the account. */
  projectName: string;
  agent: AgentSlug;
  provisionedAt: string;
  claimableUntil: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved";
  approvedByUserId: string | null;
}

export function isHandoffExpired(handoff: ClaimHandoff, now: Date): boolean {
  return now.getTime() >= Date.parse(handoff.expiresAt);
}
