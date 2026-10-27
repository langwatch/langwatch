import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** What an operator sends the license registry (ADR-156), as main's back office accepted it. */
import { statedLiteSeatsSchema } from "@langwatch/plans";
import { z } from "zod";

import { licenseCustomerSchema, licenseTermsInputSchema } from "./issued-license.ts";

/** Absent keeps every row: the console asks for active customer licenses by default. */
const issuedLicenseFiltersSchemaDefinition = z.object({
  /** Active, or the rest: revoked, superseded or expired. */
  status: z.enum(["active", "inactive"]).optional(),
  /** Customers', or internal: issued to our own domains or a name reserved for testing. */
  audience: z.enum(["customer", "internal"]).optional(),
});
export type IssuedLicenseFilters = z.infer<typeof issuedLicenseFiltersSchemaDefinition>;

const listIssuedLicensesInputSchemaDefinition = z.object({
  ...issuedLicenseFiltersSchemaDefinition.shape,
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
});
export interface ListIssuedLicensesInputSchema extends Named<
  typeof listIssuedLicensesInputSchemaDefinition
> {}
export const listIssuedLicensesInputSchema: ListIssuedLicensesInputSchema =
  listIssuedLicensesInputSchemaDefinition;

const licenseIdInputSchemaDefinition = z.object({ id: z.string().min(1) });
export interface LicenseIdInputSchema extends Named<typeof licenseIdInputSchemaDefinition> {}
export const licenseIdInputSchema: LicenseIdInputSchema = licenseIdInputSchemaDefinition;

/** What an operator supplies to issue a fresh, server-signed license. */
const issueLicenseInputSchemaDefinition = z.object({
  customer: licenseCustomerSchema,
  email: z.string().min(1),
  planType: z.string().min(1),
  maxMembers: z.number().int().min(1),
  maxMembersLite: statedLiteSeatsSchema.optional(),
  maxMessagesPerMonth: z.number().int().positive().optional(),
  /** ISO 8601. The instant the term ends. */
  expiresAt: z.string().min(1),
  terms: licenseTermsInputSchema.optional(),
});
export interface IssueLicenseInputSchema extends Named<typeof issueLicenseInputSchemaDefinition> {}
export const issueLicenseInputSchema: IssueLicenseInputSchema = issueLicenseInputSchemaDefinition;
export type IssueLicenseInput = z.infer<typeof issueLicenseInputSchema> & { operatorId: string };

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
  maxMembersLite: statedLiteSeatsSchema.optional(),
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
