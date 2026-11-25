import type { Named } from "@langwatch/module";
import {
  DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
  DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
} from "@langwatch/plans";
import { z } from "zod";

import type { OpsOperator } from "../../ops.responses.ts";
import { adminAuditRequestSchema, adminResourceNameSchema } from "./admin.ts";

export const adminOperationMethodSchema = z.enum([
  "getList",
  "getOne",
  "getMany",
  "getManyReference",
  "create",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

const adminPaginationSchema = z.object({
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(200).optional(),
});

const adminSortSchema = z.object({
  field: z.string().min(1).max(100).optional(),
  order: z.enum(["ASC", "DESC"]).optional(),
});

const adminOperationParamsSchemaDefinition = z
  .object({
    pagination: adminPaginationSchema.optional(),
    sort: adminSortSchema.optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    previousData: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());
export interface AdminOperationParamsSchema extends Named<
  typeof adminOperationParamsSchemaDefinition
> {}
export const adminOperationParamsSchema: AdminOperationParamsSchema =
  adminOperationParamsSchemaDefinition;

const adminOperationRequestSchemaDefinition = z.object({
  resource: adminResourceNameSchema,
  method: adminOperationMethodSchema,
  params: adminOperationParamsSchema,
});
export interface AdminOperationRequestSchema extends Named<
  typeof adminOperationRequestSchemaDefinition
> {}
export const adminOperationRequestSchema: AdminOperationRequestSchema =
  adminOperationRequestSchemaDefinition;

const adminOperationInputSchemaDefinition = z.object({
  ...adminOperationRequestSchema.shape,
  actorId: z.string().min(1),
  req: adminAuditRequestSchema,
});
export interface AdminOperationInputSchema extends Named<
  typeof adminOperationInputSchemaDefinition
> {}
export const adminOperationInputSchema: AdminOperationInputSchema =
  adminOperationInputSchemaDefinition;

const BYTES_PER_MEBIBYTE = 1024 * 1024;

/** The smallest and largest per-file dataset limit an operator can give an organization, in MB. */
export const ORGANIZATION_DATASET_ATTACHMENT_MIN_MB =
  DATASET_ATTACHMENT_DEFAULT_MAX_BYTES / BYTES_PER_MEBIBYTE;
export const ORGANIZATION_DATASET_ATTACHMENT_MAX_MB =
  DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES / BYTES_PER_MEBIBYTE;

/** An organization's per-file dataset limit as the back office writes it: null clears it. */
export const organizationDatasetAttachmentMaxMbSchema = z
  .number()
  .int()
  .min(ORGANIZATION_DATASET_ATTACHMENT_MIN_MB)
  .max(ORGANIZATION_DATASET_ATTACHMENT_MAX_MB)
  .nullable();

/** What an operator is told when the per-file dataset limit they entered is refused. */
export const ORGANIZATION_DATASET_ATTACHMENT_MAX_MB_REFUSAL = `Enter a whole number of megabytes from ${ORGANIZATION_DATASET_ATTACHMENT_MIN_MB} to ${ORGANIZATION_DATASET_ATTACHMENT_MAX_MB}, or leave it empty for the default.`;

/** `POST /api/admin/impersonate`'s body: who to become, and why. */
const adminImpersonationRequestSchemaDefinition = z.object({
  userIdToImpersonate: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});
export interface AdminImpersonationRequestSchema extends Named<
  typeof adminImpersonationRequestSchemaDefinition
> {}
export const adminImpersonationRequestSchema: AdminImpersonationRequestSchema =
  adminImpersonationRequestSchemaDefinition;

const adminEmptyRequestSchemaDefinition = z.object({});
export interface AdminEmptyRequestSchema extends Named<typeof adminEmptyRequestSchemaDefinition> {}
export const adminEmptyRequestSchema: AdminEmptyRequestSchema = adminEmptyRequestSchemaDefinition;
const adminAuthSessionSchemaDefinition = z.object({ id: z.string().min(1) }).nullable();
export interface AdminAuthSessionSchema extends Named<typeof adminAuthSessionSchemaDefinition> {}
export const adminAuthSessionSchema: AdminAuthSessionSchema = adminAuthSessionSchemaDefinition;
const adminResourceParamsSchemaDefinition = z.object({ resource: z.string().min(1) });
export interface AdminResourceParamsSchema extends Named<
  typeof adminResourceParamsSchemaDefinition
> {}
export const adminResourceParamsSchema: AdminResourceParamsSchema =
  adminResourceParamsSchemaDefinition;
const adminOperationBodySchemaDefinition = z.object({
  method: adminOperationMethodSchema,
  params: adminOperationParamsSchema.default({}),
});
export interface AdminOperationBodySchema extends Named<
  typeof adminOperationBodySchemaDefinition
> {}
export const adminOperationBodySchema: AdminOperationBodySchema =
  adminOperationBodySchemaDefinition;

const adminImpersonationStartedSchemaDefinition = z.object({
  message: z.literal("Impersonation started"),
});
export interface AdminImpersonationStartedSchema extends Named<
  typeof adminImpersonationStartedSchemaDefinition
> {}
export const adminImpersonationStartedSchema: AdminImpersonationStartedSchema =
  adminImpersonationStartedSchemaDefinition;
const adminImpersonationStoppedSchemaDefinition = z.object({
  message: z.literal("Impersonation ended"),
});
export interface AdminImpersonationStoppedSchema extends Named<
  typeof adminImpersonationStoppedSchemaDefinition
> {}
export const adminImpersonationStoppedSchema: AdminImpersonationStoppedSchema =
  adminImpersonationStoppedSchemaDefinition;

export type AdminOperationInput = z.infer<typeof adminOperationInputSchema>;
export type AdminOperationParams = z.infer<typeof adminOperationParamsSchema>;

const adminListResultSchemaDefinition = z.object({
  data: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
});
export interface AdminListResultSchema extends Named<typeof adminListResultSchemaDefinition> {}
export const adminListResultSchema: AdminListResultSchema = adminListResultSchemaDefinition;

const adminDataResultSchemaDefinition = z.object({ data: z.unknown() });
export interface AdminDataResultSchema extends Named<typeof adminDataResultSchemaDefinition> {}
export const adminDataResultSchema: AdminDataResultSchema = adminDataResultSchemaDefinition;

const adminOperationResultSchemaDefinition = z.union([
  adminListResultSchema,
  adminDataResultSchema,
]);
export interface AdminOperationResultSchema extends Named<
  typeof adminOperationResultSchemaDefinition
> {}
export const adminOperationResultSchema: AdminOperationResultSchema =
  adminOperationResultSchemaDefinition;
const adminOperationResponseSchemaDefinition = z.object({
  data: z.unknown(),
  total: z.number().int().nonnegative().optional(),
});
export interface AdminOperationResponseSchema extends Named<
  typeof adminOperationResponseSchemaDefinition
> {}
export const adminOperationResponseSchema: AdminOperationResponseSchema =
  adminOperationResponseSchemaDefinition;

export type AdminListResult = z.infer<typeof adminListResultSchema>;
export type AdminDataResult = z.infer<typeof adminDataResultSchema>;
export type AdminOperationResult = z.infer<typeof adminOperationResultSchema>;

type AdminRouteFacts = Readonly<{
  actor: OpsOperator | null;
  session: z.infer<typeof adminAuthSessionSchema>;
  req: z.infer<typeof adminAuditRequestSchema>;
}>;

export type StartAdminImpersonationInput = AdminRouteFacts &
  z.infer<typeof adminImpersonationRequestSchema>;
export type StopAdminImpersonationInput = AdminRouteFacts;
export type RunAdminOperationInput = Omit<AdminRouteFacts, "session"> &
  z.infer<typeof adminResourceParamsSchema> &
  z.infer<typeof adminOperationBodySchema>;
export type AdminImpersonationStarted = z.infer<typeof adminImpersonationStartedSchema>;
export type AdminImpersonationStopped = z.infer<typeof adminImpersonationStoppedSchema>;
