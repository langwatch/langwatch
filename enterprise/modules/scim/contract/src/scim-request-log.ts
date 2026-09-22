// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/**
 * How long a recorded request is kept (ADR-126).
 *
 * This is evidence, not truth, so it has a window an event log would never
 * have. Thirty days is the span of the question it answers — "did the sync I
 * configured arrive, and what did you make of it" — with room for somebody to
 * come back to it after a weekend and a support round trip.
 */
export const SCIM_REQUEST_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** What a refusal is called, so a reader branches on the slug and never on
 *  the sentence beside it. */
export const scimRefusalReasonSchema = z.enum([
  "plan_not_entitled",
  /** "You may not", where the cause is not a lapsed plan — a provider
   *  touching somebody another connection provisioned is the usual one. */
  "forbidden",
  "unauthorized",
  "malformed_body",
  "invalid_resource",
  "not_found",
  "conflict",
  "rate_limited",
  "unsupported",
  "internal_error",
]);
export type ScimRefusalReason = z.infer<typeof scimRefusalReasonSchema>;

export const scimRequestRecordSchema = z
  .object({
    organizationId: z.string().min(1),
    connectionId: z.string().nullable(),
    method: z.string().min(1),
    /** The SCIM resource asked for ("Users", "Users/:id", "Groups"), never the
     *  raw path: a path carries ids and query strings, and this is read by
     *  people rather than matched by machines. */
    resource: z.string().min(1),
    status: z.number().int(),
    reason: scimRefusalReasonSchema.nullable(),
    /** Our own short sentence, customer-safe. */
    detail: z.string().nullable(),
  })
  .strict();
export type ScimRequestRecord = z.infer<typeof scimRequestRecordSchema>;

export const scimRequestLogEntrySchema = scimRequestRecordSchema
  .safeExtend({ id: z.string(), occurredAt: z.date() })
  .strict();
export type ScimRequestLogEntry = z.infer<typeof scimRequestLogEntrySchema>;

export const scimRequestLogQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    connectionId: z.string().min(1),
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();
export type ScimRequestLogQuery = z.infer<typeof scimRequestLogQuerySchema>;

/**
 * One recorded request, as a reader sees it: what was asked and what we
 * answered. The tenant and the connection are the question rather than the
 * answer, so neither is repeated on every row.
 */
export const scimRequestEntrySchema = scimRequestLogEntrySchema
  .omit({ organizationId: true, connectionId: true })
  .strict();
export type ScimRequestEntry = z.infer<typeof scimRequestEntrySchema>;

export const scimConnectionRequestsInputSchema = z
  .object({ organizationId: z.string().min(1), connectionId: z.string().min(1) })
  .strict();
export type ScimConnectionRequestsInput = z.infer<typeof scimConnectionRequestsInputSchema>;

/** How many lines the feed carries. The question it answers is about the last
 *  few minutes, so it is bounded rather than paged: a page control here would
 *  invite reading it as an audit trail, which the audit page already is. */
export const SCIM_REQUEST_FEED_LIMIT = 25;
