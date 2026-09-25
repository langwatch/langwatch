/** The license registry (ADR-156). `licensing` is an enterprise module, so
 * every shape here is declared locally rather than imported from it. */
import { z } from "zod";

const issuedLicenseSourceSchema = z.enum(["BACKOFFICE", "PURCHASE", "SCRIPT", "LEGACY_IMPORT"]);

const issuedLicenseStatusSchema = z.enum(["active", "revoked", "superseded", "expired"]);

const seatCurrencySchema = z.enum(["USD", "EUR"]);

/** A registry row as the backoffice reads it — never the held license itself. */
export const issuedLicenseViewSchema = z.object({
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
export type IssuedLicenseView = z.infer<typeof issuedLicenseViewSchema>;

export const issuedLicensePageSchema = z.object({
  licenses: z.array(issuedLicenseViewSchema),
  total: z.number(),
});
export type IssuedLicensePage = z.infer<typeof issuedLicensePageSchema>;

export const listIssuedLicensesInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(25),
  search: z.string().optional(),
});

export const licenseIdInputSchema = z.object({ id: z.string().min(1) });

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
export const issueLicenseInputSchema = z.object({
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

export const registerLegacyLicenseInputSchema = z.object({
  licenseKey: z.string().min(1),
  organizationId: z.string().min(1),
});

export const revokeIssuedLicenseInputSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
});

export const reissueLicenseInputSchema = z.object({
  id: z.string().min(1),
  maxMembers: z.number().int().min(1).optional(),
  maxMembersLite: z.number().int().min(0).optional(),
  maxMessagesPerMonth: z.number().int().positive().optional(),
  /** ISO 8601. The instant the new term ends. */
  expiresAt: z.string().min(1),
});

export const changeLicenseSeatsInputSchema = z.object({
  id: z.string().min(1),
  maxMembers: z.number().int().min(1),
});

export const updateLicenseTermsInputSchema = z.object({
  id: z.string().min(1),
  ...licenseTermsInputSchema.shape,
});

export const linkLicenseToOrganizationInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

/** A signed license and the row that records it. The key is handed over once. */
export const signedIssuedLicenseSchema = z.object({
  licenseKey: z.string(),
  license: issuedLicenseViewSchema,
});
export type SignedIssuedLicense = z.infer<typeof signedIssuedLicenseSchema>;

const seatChangeBillingOutcomeSchema = z.enum(["invoiced", "nothing_to_invoice", "not_onboarded"]);

export const seatChangeResultSchema = z.object({
  ...signedIssuedLicenseSchema.shape,
  previousMaxMembers: z.number(),
  billing: seatChangeBillingOutcomeSchema,
});
export type SeatChangeResult = z.infer<typeof seatChangeResultSchema>;
