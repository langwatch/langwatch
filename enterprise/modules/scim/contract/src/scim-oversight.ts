// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The platform operator's view of directory sync across every customer
 * (ADR-122): reason codes, attempt counts and the directory's identifier
 * mapping, which the organization view never shows.
 */
import { z } from "zod";

/** How many mapping rows the operator drawer reads at once. */
export const DIRECTORY_IDENTITY_PAGE_SIZE = 100;

/** One failure as the operator reads it: reason code, attempts and all. */
export const oversightFailureSchema = z
  .object({
    /** Identity's apply operation, e.g. `deactivate_user`. */
    op: z.string(),
    errorCode: z.string(),
    attempts: z.number().int(),
    retiredAtMs: z.number().int().nullable(),
    redrivenAtMs: z.number().int().nullable(),
    userId: z.string().nullable(),
    occurredAtMs: z.number().int(),
  })
  .strict();
export type OversightFailure = z.infer<typeof oversightFailureSchema>;

/** One connection's sync, on the cross-customer list. */
export const oversightSyncSchema = z
  .object({
    connectionId: z.string(),
    organizationId: z.string(),
    organizationName: z.string().nullable(),
    state: z.string(),
    lastPushedAtMs: z.number().int().nullable(),
    revokedCause: z.string().nullable(),
    lastFailure: oversightFailureSchema.nullable(),
    deadLetters: oversightFailureSchema.array(),
    updatedAtMs: z.number().int(),
  })
  .strict();
export type OversightSync = z.infer<typeof oversightSyncSchema>;

export const oversightSyncListSchema = z
  .object({ syncs: oversightSyncSchema.array(), total: z.number().int() })
  .strict();
export type OversightSyncList = z.infer<typeof oversightSyncListSchema>;

/** Which person the directory knows by which identifier, on one connection. */
export const directoryIdentityRowSchema = z
  .object({
    connectionId: z.string(),
    externalId: z.string(),
    userId: z.string(),
    createdAtMs: z.number().int(),
    updatedAtMs: z.number().int(),
  })
  .strict();
export type DirectoryIdentityRow = z.infer<typeof directoryIdentityRowSchema>;

export const listOversightSyncsInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(253).optional(),
});
export type ListOversightSyncsInput = z.infer<typeof listOversightSyncsInputSchema>;

export const oversightConnectionInputSchema = z.object({ connectionId: z.string().min(1) });
export type OversightConnectionInput = z.infer<typeof oversightConnectionInputSchema>;

export const redriveRetiredApplyInputSchema = z.object({
  connectionId: z.string().min(1),
  /** Which dead letter, by the business time it was retired at. */
  retiredAtMs: z.number().int().nonnegative(),
});
export type RedriveRetiredApplyInput = z.infer<typeof redriveRetiredApplyInputSchema>;

export const redriveRetiredApplyResultSchema = z.object({ applied: z.boolean() }).strict();
export type RedriveRetiredApplyResult = z.infer<typeof redriveRetiredApplyResultSchema>;

/** The operator a surface authenticated; the impersonator where there is one. */
export type ScimOperator = Readonly<{
  id: string;
  impersonatorId?: string | undefined;
}>;
