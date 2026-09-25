// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The short code a fresh install pastes instead of a license blob (ADR-156,
 * section 5), as it leaves the feature. The code itself never crosses: a row holds its hash and hint.
 * @see specs/self-hosting/connected-services/activation-codes.feature
 */
import { z } from "zod";

export const activationCodeStatusSchema = z.enum(["active", "redeemed", "expired", "revoked"]);
export type ActivationCodeStatus = z.infer<typeof activationCodeStatusSchema>;

/** A code as the backoffice reads it, with the verdict already worked out. */
export const activationCodeViewSchema = z.object({
  id: z.string(),
  /** The last four characters, which is how two codes are told apart. */
  codeHint: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  email: z.string(),
  planType: z.string(),
  maxMembers: z.number(),
  maxMembersLite: z.number(),
  /** How long the license this code mints runs for. */
  licenseTermDays: z.number(),
  services: z.array(z.string()),
  /** When the code stops working, which is not the term of what it mints. */
  expiresAt: z.string(),
  /** A code a customer may redeem on more than one install, for a rollout. */
  reusable: z.boolean(),
  redeemedAt: z.string().nullable(),
  redeemedByInstanceId: z.string().nullable(),
  issuedLicenseId: z.string().nullable(),
  redemptionCount: z.number(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  status: activationCodeStatusSchema,
});
export type ActivationCodeView = z.infer<typeof activationCodeViewSchema>;

export const activationCodePageSchema = z.object({
  codes: z.array(activationCodeViewSchema),
  total: z.number(),
});
export type ActivationCodePage = z.infer<typeof activationCodePageSchema>;

export const listActivationCodesInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  organizationId: z.string().min(1).optional(),
});

/** What an operator supplies when minting a code from the backoffice. */
export const issueActivationCodeInputSchema = z.object({
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  email: z.string().min(1),
  planType: z.string().min(1),
  maxMembers: z.number().int().min(1),
  maxMembersLite: z.number().int().min(0).optional(),
  licenseTermDays: z.number().int().min(1),
  services: z.array(z.string()).optional(),
  /** ISO 8601. The instant the code stops working. */
  expiresAt: z.string().min(1),
  reusable: z.boolean().optional(),
});
export type IssueActivationCodeInput = z.infer<typeof issueActivationCodeInputSchema> & {
  operatorId: string;
};

export const revokeActivationCodeInputSchema = z.object({ id: z.string().min(1) });

/** The code in plain text, shown once, beside the row that will outlive it. */
export const issuedActivationCodeSchema = z.object({
  code: z.string(),
  row: activationCodeViewSchema,
});
export type IssuedActivationCode = z.infer<typeof issuedActivationCodeSchema>;

/** What an install gets back for a code it redeemed: one license, once. */
export interface ActivationRedemption {
  licenseKey: string;
  planType: string;
  maxMembers: number;
  /** ISO instant the minted license's term ends. */
  expiresAt: string;
  services: string[];
}
