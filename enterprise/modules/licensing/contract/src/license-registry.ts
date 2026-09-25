// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** What an operator sends the license registry (ADR-156), as main's back office accepted it. */
import { z } from "zod";

import { licenseCustomerSchema, licenseTermsInputSchema } from "./issued-license.ts";

export const listIssuedLicensesInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
});

export const licenseIdInputSchema = z.object({ id: z.string().min(1) });

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
export type IssueLicenseInput = z.infer<typeof issueLicenseInputSchema> & { operatorId: string };

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
