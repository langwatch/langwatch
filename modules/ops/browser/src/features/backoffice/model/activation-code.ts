/** An activation code as the Backoffice reads it (ADR-156, section 5).
 * Declared here, not derived from `RouterOutputs`: model stays pure and
 * behavior depends on it, never the reverse. */
export interface ActivationCode {
  id: string;
  codeHint: string;
  organizationId: string;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite: number;
  licenseTermDays: number;
  services: string[];
  expiresAt: string;
  reusable: boolean;
  redeemedAt: string | null;
  redeemedByInstanceId: string | null;
  issuedLicenseId: string | null;
  redemptionCount: number;
  revokedAt: string | null;
  createdAt: string;
  status: "active" | "redeemed" | "expired" | "revoked";
}

export const ACTIVATION_CODE_STATUS_COLORS: Record<ActivationCode["status"], string> = {
  active: "green",
  redeemed: "gray",
  expired: "orange",
  revoked: "red",
};
