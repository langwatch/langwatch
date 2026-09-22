// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The organization's view of its own directory sync (ADR-122).
 *
 * What the page is handed is WORDS. Identity holds a lifecycle state and a
 * reason code, and neither is something a customer should have to read, so
 * the translation happens once on the way out and the page renders what it
 * is given.
 */
import { z } from "zod";

/** Whether the reader has something to do, not how far along the sync is. */
export const scimSyncToneSchema = z.enum(["waiting", "working", "attention", "ended"]);
export type ScimSyncTone = z.infer<typeof scimSyncToneSchema>;

export const scimSyncStatusCopySchema = z
  .object({ headline: z.string(), waitingFor: z.string(), tone: scimSyncToneSchema })
  .strict();
export type ScimSyncStatusCopy = z.infer<typeof scimSyncStatusCopySchema>;

/** One thing the directory asked for that has not been applied. */
export const scimReconciliationFailureSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    occurredAtMs: z.number().int(),
    /** Set once it will not be retried again. */
    retired: z.boolean(),
  })
  .strict();
export type ScimReconciliationFailure = z.infer<typeof scimReconciliationFailureSchema>;

/** One membership change the directory itself caused. */
export const scimReconciliationChangeSchema = z
  .object({
    grantId: z.string(),
    summary: z.string(),
    /** Always the directory: a change nobody in the organization made needs
     *  an author a reader can name before they go looking for who did it. */
    author: z.string(),
    occurredAtMs: z.number().int(),
    kind: z.enum(["attached", "removed"]),
  })
  .strict();
export type ScimReconciliationChange = z.infer<typeof scimReconciliationChangeSchema>;

export const connectionReconciliationSchema = z
  .object({
    connectionId: z.string(),
    /** What the administrator registered the provider as. */
    providerId: z.string(),
    /** The domains this connection proved, which are the ones it routes.
     *  Empty until one is proved. */
    verifiedDomains: z.string().array(),
    /** Identity's lifecycle word for the connection itself. */
    connectionState: z.string(),
    /** Identity's word for the sync, null where no token has ever been minted. */
    state: z.string().nullable(),
    status: scimSyncStatusCopySchema,
    lastPushedAtMs: z.number().int().nullable(),
    managedPeople: z.number().int(),
    failures: scimReconciliationFailureSchema.array(),
    /** Why no surface here offers a retry. */
    remediation: z.string(),
  })
  .strict();
export type ConnectionReconciliation = z.infer<typeof connectionReconciliationSchema>;

export const organizationReconciliationSchema = z
  .object({
    connections: connectionReconciliationSchema.array(),
    recentChanges: scimReconciliationChangeSchema.array(),
  })
  .strict();
export type OrganizationReconciliation = z.infer<typeof organizationReconciliationSchema>;

/**
 * One person one connection's directory has claimed, by the identifier it
 * knows them by. Scim's own row: the directory module is the only thing that
 * writes or reads the mapping.
 */
export interface ScimDirectoryOwnership {
  connectionId: string;
  userId: string;
}

/** The organization the read is BUILT from, never a filter beside an id. */
export const scimReconciliationScopeSchema = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export type ScimReconciliationScope = z.infer<typeof scimReconciliationScopeSchema>;

/**
 * How many directory-caused changes the panel reads at once. A cap rather
 * than a page: a customer who needs the whole history has the audit page.
 */
export const RECENT_DIRECTORY_CHANGE_LIMIT = 50;
