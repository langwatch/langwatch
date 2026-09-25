// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The license registry as everything outside the feature reads it (ADR-156).
 * What crosses is the view, never the held license; timestamps are ISO strings.
 */
import { z } from "zod";

import { CONNECT_SERVICES } from "./connect-services.ts";

export const issuedLicenseSourceSchema = z.enum([
  "BACKOFFICE",
  "PURCHASE",
  "SCRIPT",
  "LEGACY_IMPORT",
]);
export type IssuedLicenseSource = z.infer<typeof issuedLicenseSourceSchema>;

/** The currencies a seat contract is priced in, as the schema's `Currency` enum has them. */
export const seatCurrencySchema = z.enum(["USD", "EUR"]);
export type SeatCurrency = z.infer<typeof seatCurrencySchema>;

export const issuedLicenseStatusSchema = z.enum(["active", "revoked", "superseded", "expired"]);
export type IssuedLicenseStatus = z.infer<typeof issuedLicenseStatusSchema>;

/** A registry row as an operator surface reads it, without the held license. */
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
  /** Whether a reissued license is waiting to be delivered to its install. */
  hasPendingDelivery: z.boolean(),
});
export type IssuedLicenseView = z.infer<typeof issuedLicenseViewSchema>;

export const issuedLicensePageSchema = z.object({
  licenses: z.array(issuedLicenseViewSchema),
  total: z.number(),
});
export type IssuedLicensePage = z.infer<typeof issuedLicensePageSchema>;

/** The customer a license is issued to: one that exists, or a new one to create. */
export const licenseCustomerSchema = z.union([
  z.object({ organizationId: z.string().min(1) }),
  z.object({ newOrganizationName: z.string().min(1) }),
]);
export type LicenseCustomer = z.infer<typeof licenseCustomerSchema>;

/** The commercial terms an operator sets on a license. */
export const licenseTermsInputSchema = z.object({
  services: z.array(z.enum(CONNECT_SERVICES)).optional(),
  seatRateCents: z.number().int().min(0).nullable().optional(),
  seatCurrency: seatCurrencySchema.nullable().optional(),
  commitUsdCents: z.number().int().min(0).optional(),
  overageEnabled: z.boolean().optional(),
  overageMaxUsdCents: z.number().int().min(0).nullable().optional(),
});
export type LicenseTermsInput = z.infer<typeof licenseTermsInputSchema>;

/** A signed license and the row that records it. The key is handed over once. */
export const signedIssuedLicenseSchema = z.object({
  licenseKey: z.string(),
  license: issuedLicenseViewSchema,
});
export type SignedIssuedLicense = z.infer<typeof signedIssuedLicenseSchema>;

/** What a mid-term seat change owes; billing decides the amount. */
export const seatChangeBillingOutcomeSchema = z.enum([
  "invoiced",
  "nothing_to_invoice",
  "not_onboarded",
]);
export type SeatChangeBillingOutcome = z.infer<typeof seatChangeBillingOutcomeSchema>;

export const seatChangeResultSchema = z.object({
  ...signedIssuedLicenseSchema.shape,
  previousMaxMembers: z.number(),
  billing: seatChangeBillingOutcomeSchema,
});
export type SeatChangeResult = z.infer<typeof seatChangeResultSchema>;

/** The customer organization a license is attributed to, as the registry needs it. */
export interface IssuedLicenseCustomerRecord {
  id: string;
  name: string;
}

/**
 * What a hosted route learns from a presented license token: who to attribute
 * the call to, and the terms that bound it. Never the token, never the seats.
 */
export interface ConnectCredentialGrant {
  licenseRowId: string;
  licenseId: string;
  organizationId: string;
  instanceId: string;
  virtualKeyId: string;
  services: string[];
  commitUsdCents: number;
  overageEnabled: boolean;
  overageMaxUsdCents: number | null;
}
