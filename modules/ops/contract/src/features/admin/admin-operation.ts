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

export const adminOperationParamsSchema = z
  .object({
    pagination: adminPaginationSchema.optional(),
    sort: adminSortSchema.optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    previousData: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());

export const adminOperationRequestSchema = z.object({
  resource: adminResourceNameSchema,
  method: adminOperationMethodSchema,
  params: adminOperationParamsSchema,
});

export const adminOperationInputSchema = z.object({
  ...adminOperationRequestSchema.shape,
  actorId: z.string().min(1),
  req: adminAuditRequestSchema,
});

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
export const adminImpersonationRequestSchema = z.object({
  userIdToImpersonate: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const adminEmptyRequestSchema = z.object({});
export const adminAuthSessionSchema = z.object({ id: z.string().min(1) }).nullable();
export const adminResourceParamsSchema = z.object({ resource: z.string().min(1) });
export const adminOperationBodySchema = z.object({
  method: adminOperationMethodSchema,
  params: adminOperationParamsSchema.default({}),
});

export const adminImpersonationStartedSchema = z.object({
  message: z.literal("Impersonation started"),
});
export const adminImpersonationStoppedSchema = z.object({
  message: z.literal("Impersonation ended"),
});

export type AdminOperationInput = z.infer<typeof adminOperationInputSchema>;
export type AdminOperationParams = z.infer<typeof adminOperationParamsSchema>;

export const adminListResultSchema = z.object({
  data: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
});

export const adminDataResultSchema = z.object({ data: z.unknown() });

export const adminOperationResultSchema = z.union([adminListResultSchema, adminDataResultSchema]);
export const adminOperationResponseSchema = z.object({
  data: z.unknown(),
  total: z.number().int().nonnegative().optional(),
});

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
