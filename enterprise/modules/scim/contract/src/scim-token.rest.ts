// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The wire shapes the `/api/scim-tokens` REST family publishes. */
import { z } from "zod";

export const scimTokenRestSummarySchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  /** D08: which single sign-on connection this token reaches. An id, never a
   *  secret — and the most important thing about a token, so it is listed. */
  connectionId: z.string().nullable(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
});

export const scimTokenIdParamsSchema = z.object({ id: z.string().min(1) });

export const scimTokenCreateRestInputSchema = z.object({
  description: z.string().trim().min(1).max(255).optional(),
  /** D08: the connection this token is for, and the whole of its write
   *  authority. Optional on the wire and required by the application, so a
   *  provisioning tool that has not been updated gets the named
   *  `scim_connection_required` refusal rather than a schema error. */
  connectionId: z.string().trim().min(1).optional(),
});
