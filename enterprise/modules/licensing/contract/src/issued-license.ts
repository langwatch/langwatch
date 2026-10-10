import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The license registry as everything outside the feature reads it (ADR-156).
 * What crosses is the view, never the held license; timestamps are ISO strings.
 */
import { z } from "zod";

/**
 * The hosted services a license can be entitled to, named the way the license
 * registry, the install's opt-in and the hosted routes all name them (ADR-156).
 */
export const CONNECT_SERVICES = ["instant_evals", "managed_models"] as const;

export type ConnectService = (typeof CONNECT_SERVICES)[number];

/** The services an answer may name, which are the ones an install knows. */
export function entitledConnectServices(services: readonly string[]): ConnectService[] {
  return services.filter((service): service is ConnectService =>
    (CONNECT_SERVICES as readonly string[]).includes(service),
  );
}

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
  /** Whether a reissued license is waiting to be delivered to its install. */
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

/** The customer a license is issued to: one that exists, or a new one to create. */
const licenseCustomerSchemaDefinition = z.union([
  z.object({ organizationId: z.string().min(1) }),
  z.object({ newOrganizationName: z.string().min(1) }),
]);
export interface LicenseCustomerSchema extends Named<typeof licenseCustomerSchemaDefinition> {}
export const licenseCustomerSchema: LicenseCustomerSchema = licenseCustomerSchemaDefinition;
export type LicenseCustomer = z.infer<typeof licenseCustomerSchema>;

/** The commercial terms an operator sets on a license. */
const licenseTermsInputSchemaDefinition = z.object({
  services: z.array(z.enum(CONNECT_SERVICES)).optional(),
  seatRateCents: z.number().int().min(0).nullable().optional(),
  seatCurrency: seatCurrencySchema.nullable().optional(),
  commitUsdCents: z.number().int().min(0).optional(),
  overageEnabled: z.boolean().optional(),
  overageMaxUsdCents: z.number().int().min(0).nullable().optional(),
});
export interface LicenseTermsInputSchema extends Named<typeof licenseTermsInputSchemaDefinition> {}
export const licenseTermsInputSchema: LicenseTermsInputSchema = licenseTermsInputSchemaDefinition;
export type LicenseTermsInput = z.infer<typeof licenseTermsInputSchema>;

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

/**
 * What a seat change leaves billing. `pending`: the seats of a linked license
 * went up, and billing invoices them from the fact licensing recorded; its
 * outcome shows in the Billing section. Anything else owes nothing here.
 */
export const seatChangeBillingOutcomeSchema = z.enum(["pending", "nothing_to_invoice"]);
export type SeatChangeBillingOutcome = z.infer<typeof seatChangeBillingOutcomeSchema>;

const seatChangeResultSchemaDefinition = z.object({
  ...signedIssuedLicenseSchema.shape,
  previousMaxMembers: z.number(),
  billing: seatChangeBillingOutcomeSchema,
});
export interface SeatChangeResultSchema extends Named<typeof seatChangeResultSchemaDefinition> {}
export const seatChangeResultSchema: SeatChangeResultSchema = seatChangeResultSchemaDefinition;
export type SeatChangeResult = z.infer<typeof seatChangeResultSchema>;

/** A seat change that raised a linked license: the fact billing invoices from. */
const licenseSeatChangeSchemaDefinition = z.object({
  /** The replacement registry row the new seat count is signed into. */
  licenseRowId: z.string(),
  organizationId: z.string(),
  previousSeats: z.number().int(),
  seats: z.number().int(),
  /** ISO 8601. When the replacement was signed; proration counts from here. */
  changedAt: z.string(),
});
export interface LicenseSeatChangeSchema extends Named<typeof licenseSeatChangeSchemaDefinition> {}
export const licenseSeatChangeSchema: LicenseSeatChangeSchema = licenseSeatChangeSchemaDefinition;
export type LicenseSeatChange = z.infer<typeof licenseSeatChangeSchema>;

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
