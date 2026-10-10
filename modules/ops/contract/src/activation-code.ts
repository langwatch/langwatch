import type { Named } from "@langwatch/module";
/** Activation codes (ADR-156, section 5), as the license registry's admin console
 * reads and writes them. `licensing` is enterprise, so every shape here is
 * declared locally rather than imported from it (as `license-registry.ts`). */
import { z } from "zod";

const activationCodeStatusSchema = z.enum(["active", "redeemed", "expired", "revoked"]);

/** A code as the admin console reads it — never the code itself, only its hint. */
const activationCodeViewSchemaDefinition = z.object({
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
export interface ActivationCodeViewSchema extends Named<
  typeof activationCodeViewSchemaDefinition
> {}
export const activationCodeViewSchema: ActivationCodeViewSchema =
  activationCodeViewSchemaDefinition;
export type ActivationCodeView = z.infer<typeof activationCodeViewSchema>;

const activationCodePageSchemaDefinition = z.object({
  codes: z.array(activationCodeViewSchema),
  total: z.number(),
});
export interface ActivationCodePageSchema extends Named<
  typeof activationCodePageSchemaDefinition
> {}
export const activationCodePageSchema: ActivationCodePageSchema =
  activationCodePageSchemaDefinition;
export type ActivationCodePage = z.infer<typeof activationCodePageSchema>;

const listActivationCodesInputSchemaDefinition = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(25),
  organizationId: z.string().min(1).optional(),
});
export interface ListActivationCodesInputSchema extends Named<
  typeof listActivationCodesInputSchemaDefinition
> {}
export const listActivationCodesInputSchema: ListActivationCodesInputSchema =
  listActivationCodesInputSchemaDefinition;

/** What an operator supplies when minting a code from the admin console. */
const issueActivationCodeInputSchemaDefinition = z.object({
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
export interface IssueActivationCodeInputSchema extends Named<
  typeof issueActivationCodeInputSchemaDefinition
> {}
export const issueActivationCodeInputSchema: IssueActivationCodeInputSchema =
  issueActivationCodeInputSchemaDefinition;

const revokeActivationCodeInputSchemaDefinition = z.object({ id: z.string().min(1) });
export interface RevokeActivationCodeInputSchema extends Named<
  typeof revokeActivationCodeInputSchemaDefinition
> {}
export const revokeActivationCodeInputSchema: RevokeActivationCodeInputSchema =
  revokeActivationCodeInputSchemaDefinition;

/** The code in plain text, shown once, beside the row that will outlive it. */
const issuedActivationCodeSchemaDefinition = z.object({
  code: z.string(),
  row: activationCodeViewSchema,
});
export interface IssuedActivationCodeSchema extends Named<
  typeof issuedActivationCodeSchemaDefinition
> {}
export const issuedActivationCodeSchema: IssuedActivationCodeSchema =
  issuedActivationCodeSchemaDefinition;
export type IssuedActivationCode = z.infer<typeof issuedActivationCodeSchema>;
