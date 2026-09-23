// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The short code a fresh install pastes instead of a license blob (ADR-156,
 * section 5), as it leaves the feature. Every instant is an ISO string, and
 * the code itself is never among them: a row holds its hash and its hint.
 *
 * @see specs/self-hosting/connected-services/activation-codes.feature
 */

export type ActivationCodeStatus = "active" | "redeemed" | "expired" | "revoked";

/** A code as the backoffice reads it, with the verdict already worked out. */
export interface ActivationCodeView {
  id: string;
  /** The last four characters, which is how two codes are told apart. */
  codeHint: string;
  organizationId: string;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite: number;
  /** How long the license this code mints runs for. */
  licenseTermDays: number;
  services: string[];
  /** When the code stops working, which is not the term of what it mints. */
  expiresAt: string;
  /** A code a customer may redeem on more than one install, for a rollout. */
  reusable: boolean;
  redeemedAt: string | null;
  redeemedByInstanceId: string | null;
  issuedLicenseId: string | null;
  redemptionCount: number;
  revokedAt: string | null;
  createdAt: string;
  status: ActivationCodeStatus;
}

export interface ActivationCodePage {
  codes: ActivationCodeView[];
  total: number;
}

/** What an operator supplies when minting a code from the backoffice. */
export interface IssueActivationCodeInput {
  organizationId: string;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite?: number;
  licenseTermDays: number;
  services?: string[];
  /** ISO instant the code stops working. */
  expiresAt: string;
  reusable?: boolean;
  operatorId: string;
}

/** The code in plain text, shown once, beside the row that will outlive it. */
export interface IssuedActivationCode {
  code: string;
  row: ActivationCodeView;
}

/** What an install gets back for a code it redeemed: one license, once. */
export interface ActivationRedemption {
  licenseKey: string;
  planType: string;
  maxMembers: number;
  /** ISO instant the minted license's term ends. */
  expiresAt: string;
  services: string[];
}
