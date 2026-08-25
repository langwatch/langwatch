import { z } from "zod";

import {
  adminAuditRequestSchema,
  adminResourceNameSchema,
} from "./admin";

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

export const adminOperationInputSchema = adminOperationRequestSchema.extend({
  actorId: z.string().min(1),
  req: adminAuditRequestSchema,
});

export type AdminOperationInput = z.infer<typeof adminOperationInputSchema>;
export type AdminOperationParams = z.infer<typeof adminOperationParamsSchema>;

export const adminListResultSchema = z.object({
  data: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
});

export const adminDataResultSchema = z.object({ data: z.unknown() });

export const adminOperationResultSchema = z.union([
  adminListResultSchema,
  adminDataResultSchema,
]);

export type AdminListResult = z.infer<typeof adminListResultSchema>;
export type AdminDataResult = z.infer<typeof adminDataResultSchema>;
export type AdminOperationResult = z.infer<typeof adminOperationResultSchema>;
