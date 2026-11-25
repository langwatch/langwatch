import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The wire shapes the `/api/scim-tokens` REST family publishes. */
import { z } from "zod";

const scimTokenRestSummarySchemaDefinition = z.object({
  id: z.string(),
  description: z.string().nullable(),
  /** D08: which single sign-on connection this token reaches. An id, never a
   *  secret — and the most important thing about a token, so it is listed. */
  connectionId: z.string().nullable(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
});
export interface ScimTokenRestSummarySchema extends Named<
  typeof scimTokenRestSummarySchemaDefinition
> {}
export const scimTokenRestSummarySchema: ScimTokenRestSummarySchema =
  scimTokenRestSummarySchemaDefinition;

const scimTokenIdParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface ScimTokenIdParamsSchema extends Named<typeof scimTokenIdParamsSchemaDefinition> {}
export const scimTokenIdParamsSchema: ScimTokenIdParamsSchema = scimTokenIdParamsSchemaDefinition;

/** Postgres cannot store U+0000, so input carrying one is the caller's error, not a 500. */
const withoutNullByte = (value: string) => !value.includes("\u0000");

const scimTokenCreateRestInputSchemaDefinition = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(withoutNullByte, "description must not contain a null byte")
    .optional(),
  /** D08: the connection this token is for, and the whole of its write
   *  authority. Optional on the wire and required by the application, so a
   *  provisioning tool that has not been updated gets the named
   *  `scim_connection_required` refusal rather than a schema error. */
  connectionId: z
    .string()
    .trim()
    .min(1)
    .refine(withoutNullByte, "connectionId must not contain a null byte")
    .optional(),
});
export interface ScimTokenCreateRestInputSchema extends Named<
  typeof scimTokenCreateRestInputSchemaDefinition
> {}
export const scimTokenCreateRestInputSchema: ScimTokenCreateRestInputSchema =
  scimTokenCreateRestInputSchemaDefinition;

/** The two headers an Auth0 SCIM log-stream delivery is admitted by, as the process reads them. */

const scimWebhookDeliveryHeadersSchemaDefinition = z.object({
  signature: z.string().nullable(),
  authorization: z.string().nullable(),
});
export interface ScimWebhookDeliveryHeadersSchema extends Named<
  typeof scimWebhookDeliveryHeadersSchemaDefinition
> {}
export const scimWebhookDeliveryHeadersSchema: ScimWebhookDeliveryHeadersSchema =
  scimWebhookDeliveryHeadersSchemaDefinition;
