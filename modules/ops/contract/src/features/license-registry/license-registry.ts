import type { Named } from "@langwatch/module";
/** The license registry (ADR-156). `licensing` is an enterprise module, so
 * every shape here is declared locally rather than imported from it. */
import { z } from "zod";

const issuedLicenseSourceSchema = z.enum(["BACKOFFICE", "PURCHASE", "SCRIPT", "LEGACY_IMPORT"]);

const issuedLicenseStatusSchema = z.enum(["active", "revoked", "superseded", "expired"]);

const seatCurrencySchema = z.enum(["USD", "EUR"]);

/** A registry row as the admin console reads it — never the held license itself. */
const issuedLicenseViewSchemaDefinition = z.object({
  id: z.string(),
  licenseId: z.string(),
  tokenHash: z.string(),
  organizationId: z.string().nullable(),
  organizationName: z.string(),
  email: z.string(),
  planType: z.string(),
  maxMembers: z.number(),
  maxMembersLite: z.number(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  source: issuedLicenseSourceSchema,
  issuedById: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedById: z.string().nullable(),
  revokedReason: z.string().nullable(),
  supersededAt: z.string().nullable(),
  replacesId: z.string().nullable(),
  services: z.array(z.string()),
  seatRateCents: z.number().nullable(),
  seatCurrency: seatCurrencySchema.nullable(),
  commitUsdCents: z.number(),
  overageEnabled: z.boolean(),
  overageMaxUsdCents: z.number().nullable(),
  instanceId: z.string().nullable(),
  instanceBoundAt: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastSyncVersion: z.string().nullable(),
  reportedMembers: z.number().nullable(),
  reportedMembersLite: z.number().nullable(),
  virtualKeyId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: issuedLicenseStatusSchema,
  hasPendingDelivery: z.boolean(),
});
export interface IssuedLicenseViewSchema extends Named<typeof issuedLicenseViewSchemaDefinition> {}
export const issuedLicenseViewSchema: IssuedLicenseViewSchema = issuedLicenseViewSchemaDefinition;
export type IssuedLicenseView = z.infer<typeof issuedLicenseViewSchema>;

const issuedLicensePageSchemaDefinition = z.object({
  licenses: z.array(issuedLicenseViewSchema),
  total: z.number(),
});
export interface IssuedLicensePageSchema extends Named<typeof issuedLicensePageSchemaDefinition> {}
export const issuedLicensePageSchema: IssuedLicensePageSchema = issuedLicensePageSchemaDefinition;
export type IssuedLicensePage = z.infer<typeof issuedLicensePageSchema>;

const listIssuedLicensesInputSchemaDefinition = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(25),
  search: z.string().optional(),
});
export interface ListIssuedLicensesInputSchema extends Named<
  typeof listIssuedLicensesInputSchemaDefinition
> {}
export const listIssuedLicensesInputSchema: ListIssuedLicensesInputSchema =
  listIssuedLicensesInputSchemaDefinition;

const licenseIdInputSchemaDefinition = z.object({ id: z.string().min(1) });
export interface LicenseIdInputSchema extends Named<typeof licenseIdInputSchemaDefinition> {}
export const licenseIdInputSchema: LicenseIdInputSchema = licenseIdInputSchemaDefinition;

const licenseCustomerSchema = z.union([
  z.object({ organizationId: z.string().min(1) }),
  z.object({ newOrganizationName: z.string().min(1) }),
]);
export type LicenseCustomer = z.infer<typeof licenseCustomerSchema>;

const licenseTermsInputSchema = z.object({
  services: z.array(z.string()).optional(),
  seatRateCents: z.number().nullable().optional(),
  seatCurrency: seatCurrencySchema.nullable().optional(),
  commitUsdCents: z.number().optional(),
  overageEnabled: z.boolean().optional(),
  overageMaxUsdCents: z.number().nullable().optional(),
});
export type LicenseTermsInput = z.infer<typeof licenseTermsInputSchema>;

/** What an operator supplies to issue a fresh, server-signed license. */
const issueLicenseInputSchemaDefinition = z.object({
  customer: licenseCustomerSchema,
  email: z.string().min(1),
  planType: z.string().min(1),
  maxMembers: z.number().int().min(1),
  maxMembersLite: z.number().int().min(0).optional(),
  maxMessagesPerMonth: z.number().int().positive().optional(),
  /** ISO 8601. The instant the term ends. */
  expiresAt: z.string().min(1),
  terms: licenseTermsInputSchema.optional(),
});
export interface IssueLicenseInputSchema extends Named<typeof issueLicenseInputSchemaDefinition> {}
export const issueLicenseInputSchema: IssueLicenseInputSchema = issueLicenseInputSchemaDefinition;

const registerLegacyLicenseInputSchemaDefinition = z.object({
  licenseKey: z.string().min(1),
  organizationId: z.string().min(1),
});
export interface RegisterLegacyLicenseInputSchema extends Named<
  typeof registerLegacyLicenseInputSchemaDefinition
> {}
export const registerLegacyLicenseInputSchema: RegisterLegacyLicenseInputSchema =
  registerLegacyLicenseInputSchemaDefinition;

const revokeIssuedLicenseInputSchemaDefinition = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
});
export interface RevokeIssuedLicenseInputSchema extends Named<
  typeof revokeIssuedLicenseInputSchemaDefinition
> {}
export const revokeIssuedLicenseInputSchema: RevokeIssuedLicenseInputSchema =
  revokeIssuedLicenseInputSchemaDefinition;

const reissueLicenseInputSchemaDefinition = z.object({
  id: z.string().min(1),
  maxMembers: z.number().int().min(1).optional(),
  maxMembersLite: z.number().int().min(0).optional(),
  maxMessagesPerMonth: z.number().int().positive().optional(),
  /** ISO 8601. The instant the new term ends. */
  expiresAt: z.string().min(1),
});
export interface ReissueLicenseInputSchema extends Named<
  typeof reissueLicenseInputSchemaDefinition
> {}
export const reissueLicenseInputSchema: ReissueLicenseInputSchema =
  reissueLicenseInputSchemaDefinition;

const changeLicenseSeatsInputSchemaDefinition = z.object({
  id: z.string().min(1),
  maxMembers: z.number().int().min(1),
});
export interface ChangeLicenseSeatsInputSchema extends Named<
  typeof changeLicenseSeatsInputSchemaDefinition
> {}
export const changeLicenseSeatsInputSchema: ChangeLicenseSeatsInputSchema =
  changeLicenseSeatsInputSchemaDefinition;

const updateLicenseTermsInputSchemaDefinition = z.object({
  id: z.string().min(1),
  ...licenseTermsInputSchema.shape,
});
export interface UpdateLicenseTermsInputSchema extends Named<
  typeof updateLicenseTermsInputSchemaDefinition
> {}
export const updateLicenseTermsInputSchema: UpdateLicenseTermsInputSchema =
  updateLicenseTermsInputSchemaDefinition;

const linkLicenseToOrganizationInputSchemaDefinition = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});
export interface LinkLicenseToOrganizationInputSchema extends Named<
  typeof linkLicenseToOrganizationInputSchemaDefinition
> {}
export const linkLicenseToOrganizationInputSchema: LinkLicenseToOrganizationInputSchema =
  linkLicenseToOrganizationInputSchemaDefinition;

/** A signed license and the row that records it. The key is handed over once. */
const signedIssuedLicenseSchemaDefinition = z.object({
  licenseKey: z.string(),
  license: issuedLicenseViewSchema,
});
export interface SignedIssuedLicenseSchema extends Named<
  typeof signedIssuedLicenseSchemaDefinition
> {}
export const signedIssuedLicenseSchema: SignedIssuedLicenseSchema =
  signedIssuedLicenseSchemaDefinition;
export type SignedIssuedLicense = z.infer<typeof signedIssuedLicenseSchema>;

/** `pending`: billing invoices the added seats from the change licensing recorded. */
const seatChangeBillingOutcomeSchema = z.enum(["pending", "nothing_to_invoice"]);

const seatChangeResultSchemaDefinition = z.object({
  ...signedIssuedLicenseSchema.shape,
  previousMaxMembers: z.number(),
  billing: seatChangeBillingOutcomeSchema,
});
export interface SeatChangeResultSchema extends Named<typeof seatChangeResultSchemaDefinition> {}
export const seatChangeResultSchema: SeatChangeResultSchema = seatChangeResultSchemaDefinition;
export type SeatChangeResult = z.infer<typeof seatChangeResultSchema>;
