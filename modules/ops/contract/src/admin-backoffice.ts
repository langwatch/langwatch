import { z } from "zod";

import { adminAuditRequestSchema, adminResourceNameSchema } from "./admin.ts";
import type { OpsOperator } from "./ops.responses.ts";

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
