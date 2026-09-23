/** Activation codes (ADR-156, section 5), as the license registry's backoffice
 * reads and writes them. `licensing` is enterprise, so every shape here is
 * declared locally rather than imported from it (as `license-registry.ts`). */
import { z } from "zod";

const activationCodeStatusSchema = z.enum(["active", "redeemed", "expired", "revoked"]);

/** A code as the backoffice reads it — never the code itself, only its hint. */
export const activationCodeViewSchema = z.object({
  id: z.string(),
  codeHint: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  email: z.string(),
  planType: z.string(),
  maxMembers: z.number(),
  maxMembersLite: z.number(),
  licenseTermDays: z.number(),
  services: z.array(z.string()),
  expiresAt: z.string(),
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
  page: z.number().int().min(0),
  pageSize: z.number().int().min(1).max(200),
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

export const revokeActivationCodeInputSchema = z.object({ id: z.string().min(1) });

/** The code in plain text, shown once, beside the row that will outlive it. */
export const issuedActivationCodeSchema = z.object({
  code: z.string(),
  row: activationCodeViewSchema,
});
export type IssuedActivationCode = z.infer<typeof issuedActivationCodeSchema>;
