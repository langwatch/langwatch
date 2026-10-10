import type { Named } from "@langwatch/module";
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

const scimSyncStatusCopySchemaDefinition = z
  .object({ headline: z.string(), waitingFor: z.string(), tone: scimSyncToneSchema })
  .strict();
export interface ScimSyncStatusCopySchema extends Named<
  typeof scimSyncStatusCopySchemaDefinition
> {}
export const scimSyncStatusCopySchema: ScimSyncStatusCopySchema =
  scimSyncStatusCopySchemaDefinition;
export type ScimSyncStatusCopy = z.infer<typeof scimSyncStatusCopySchema>;

/** One thing the directory asked for that has not been applied. */
const scimReconciliationFailureSchemaDefinition = z
  .object({
    title: z.string(),
    description: z.string(),
    occurredAtMs: z.number().int(),
    /** Set once it will not be retried again. */
    retired: z.boolean(),
  })
  .strict();
export interface ScimReconciliationFailureSchema extends Named<
  typeof scimReconciliationFailureSchemaDefinition
> {}
export const scimReconciliationFailureSchema: ScimReconciliationFailureSchema =
  scimReconciliationFailureSchemaDefinition;
export type ScimReconciliationFailure = z.infer<typeof scimReconciliationFailureSchema>;

/** One membership change the directory itself caused. */
const scimReconciliationChangeSchemaDefinition = z
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
export interface ScimReconciliationChangeSchema extends Named<
  typeof scimReconciliationChangeSchemaDefinition
> {}
export const scimReconciliationChangeSchema: ScimReconciliationChangeSchema =
  scimReconciliationChangeSchemaDefinition;
export type ScimReconciliationChange = z.infer<typeof scimReconciliationChangeSchema>;

const connectionReconciliationSchemaDefinition = z
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
export interface ConnectionReconciliationSchema extends Named<
  typeof connectionReconciliationSchemaDefinition
> {}
export const connectionReconciliationSchema: ConnectionReconciliationSchema =
  connectionReconciliationSchemaDefinition;
export type ConnectionReconciliation = z.infer<typeof connectionReconciliationSchema>;

const organizationReconciliationSchemaDefinition = z
  .object({
    connections: connectionReconciliationSchema.array(),
    recentChanges: scimReconciliationChangeSchema.array(),
  })
  .strict();
export interface OrganizationReconciliationSchema extends Named<
  typeof organizationReconciliationSchemaDefinition
> {}
export const organizationReconciliationSchema: OrganizationReconciliationSchema =
  organizationReconciliationSchemaDefinition;
export type OrganizationReconciliation = z.infer<typeof organizationReconciliationSchema>;

/** One line of a connection's recent directory activity, said as the directory's act (ADR-126). */
const scimDirectoryActivityEntrySchemaDefinition = z
  .object({
    eventId: z.string(),
    summary: z.string(),
    occurredAtMs: z.number().int(),
    outcome: z.enum(["ok", "refused"]),
  })
  .strict();
export interface ScimDirectoryActivityEntrySchema extends Named<
  typeof scimDirectoryActivityEntrySchemaDefinition
> {}
export const scimDirectoryActivityEntrySchema: ScimDirectoryActivityEntrySchema =
  scimDirectoryActivityEntrySchemaDefinition;
export type ScimDirectoryActivityEntry = z.infer<typeof scimDirectoryActivityEntrySchema>;

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
const scimReconciliationScopeSchemaDefinition = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export interface ScimReconciliationScopeSchema extends Named<
  typeof scimReconciliationScopeSchemaDefinition
> {}
export const scimReconciliationScopeSchema: ScimReconciliationScopeSchema =
  scimReconciliationScopeSchemaDefinition;
export type ScimReconciliationScope = z.infer<typeof scimReconciliationScopeSchema>;

/** Which of these members the organization's directories created, for member provenance. */
const scimDirectoryMembersInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), userIds: z.array(z.string().min(1)) })
  .strict();
export interface ScimDirectoryMembersInputSchema extends Named<
  typeof scimDirectoryMembersInputSchemaDefinition
> {}
export const scimDirectoryMembersInputSchema: ScimDirectoryMembersInputSchema =
  scimDirectoryMembersInputSchemaDefinition;
export type ScimDirectoryMembersInput = z.infer<typeof scimDirectoryMembersInputSchema>;

/** One member a directory created; `providerId` is what registration called its provider. */
const scimDirectoryMemberSchemaDefinition = z
  .object({ userId: z.string(), providerId: z.string().nullable() })
  .strict();
export interface ScimDirectoryMemberSchema extends Named<
  typeof scimDirectoryMemberSchemaDefinition
> {}
export const scimDirectoryMemberSchema: ScimDirectoryMemberSchema =
  scimDirectoryMemberSchemaDefinition;
export type ScimDirectoryMember = z.infer<typeof scimDirectoryMemberSchema>;

/**
 * How many directory-caused changes the panel reads at once. A cap rather
 * than a page: a customer who needs the whole history has the audit page.
 */
export const RECENT_DIRECTORY_CHANGE_LIMIT = 50;

/** How many lines the activity feed carries: bounded, not paged, since the audit page is the trail. */
export const DIRECTORY_ACTIVITY_LIMIT = 25;
