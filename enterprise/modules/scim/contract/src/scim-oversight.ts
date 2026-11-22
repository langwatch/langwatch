import type { Named } from "@langwatch/module";
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
const oversightFailureSchemaDefinition = z
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
export interface OversightFailureSchema extends Named<typeof oversightFailureSchemaDefinition> {}
export const oversightFailureSchema: OversightFailureSchema = oversightFailureSchemaDefinition;

/** One connection's sync, on the cross-customer list. */
const oversightSyncSchemaDefinition = z
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
export interface OversightSyncSchema extends Named<typeof oversightSyncSchemaDefinition> {}
export const oversightSyncSchema: OversightSyncSchema = oversightSyncSchemaDefinition;
export type OversightSync = z.infer<typeof oversightSyncSchema>;

const oversightSyncListSchemaDefinition = z
  .object({ syncs: oversightSyncSchema.array(), total: z.number().int() })
  .strict();
export interface OversightSyncListSchema extends Named<typeof oversightSyncListSchemaDefinition> {}
export const oversightSyncListSchema: OversightSyncListSchema = oversightSyncListSchemaDefinition;
export type OversightSyncList = z.infer<typeof oversightSyncListSchema>;

/** Which person the directory knows by which identifier, on one connection. */
const directoryIdentityRowSchemaDefinition = z
  .object({
    connectionId: z.string(),
    externalId: z.string(),
    userId: z.string(),
    createdAtMs: z.number().int(),
    updatedAtMs: z.number().int(),
  })
  .strict();
export interface DirectoryIdentityRowSchema extends Named<
  typeof directoryIdentityRowSchemaDefinition
> {}
export const directoryIdentityRowSchema: DirectoryIdentityRowSchema =
  directoryIdentityRowSchemaDefinition;
export type DirectoryIdentityRow = z.infer<typeof directoryIdentityRowSchema>;

const listOversightSyncsInputSchemaDefinition = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(253).optional(),
});
export interface ListOversightSyncsInputSchema extends Named<
  typeof listOversightSyncsInputSchemaDefinition
> {}
export const listOversightSyncsInputSchema: ListOversightSyncsInputSchema =
  listOversightSyncsInputSchemaDefinition;
export type ListOversightSyncsInput = z.infer<typeof listOversightSyncsInputSchema>;

const oversightConnectionInputSchemaDefinition = z.object({ connectionId: z.string().min(1) });
export interface OversightConnectionInputSchema extends Named<
  typeof oversightConnectionInputSchemaDefinition
> {}
export const oversightConnectionInputSchema: OversightConnectionInputSchema =
  oversightConnectionInputSchemaDefinition;
export type OversightConnectionInput = z.infer<typeof oversightConnectionInputSchema>;

const redriveRetiredApplyInputSchemaDefinition = z.object({
  connectionId: z.string().min(1),
  /** Which dead letter, by the business time it was retired at. */
  retiredAtMs: z.number().int().nonnegative(),
});
export interface RedriveRetiredApplyInputSchema extends Named<
  typeof redriveRetiredApplyInputSchemaDefinition
> {}
export const redriveRetiredApplyInputSchema: RedriveRetiredApplyInputSchema =
  redriveRetiredApplyInputSchemaDefinition;
export type RedriveRetiredApplyInput = z.infer<typeof redriveRetiredApplyInputSchema>;

const redriveRetiredApplyResultSchemaDefinition = z.object({ applied: z.boolean() }).strict();
export interface RedriveRetiredApplyResultSchema extends Named<
  typeof redriveRetiredApplyResultSchemaDefinition
> {}
export const redriveRetiredApplyResultSchema: RedriveRetiredApplyResultSchema =
  redriveRetiredApplyResultSchemaDefinition;
export type RedriveRetiredApplyResult = z.infer<typeof redriveRetiredApplyResultSchema>;

/** The operator a surface authenticated; the impersonator where there is one. */
export type ScimOperator = Readonly<{
  id: string;
  impersonatorId?: string | undefined;
}>;
