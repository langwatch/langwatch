import { z } from "zod";

export const UNASSIGNED_DEPARTMENT = "unassigned" as const;

const departmentSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface DepartmentSchema extends Named<typeof departmentSchemaDefinition> {}
export const departmentSchema: DepartmentSchema = departmentSchemaDefinition;
export type Department = z.infer<typeof departmentSchema>;

const departmentAssignableEntitySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  departmentId: z.string().nullable(),
});
export interface DepartmentAssignableEntitySchema extends Named<
  typeof departmentAssignableEntitySchemaDefinition
> {}
export const departmentAssignableEntitySchema: DepartmentAssignableEntitySchema =
  departmentAssignableEntitySchemaDefinition;
export type DepartmentAssignableEntity = z.infer<typeof departmentAssignableEntitySchema>;

const departmentAssignableUserSchemaDefinition = z.object({
  ...departmentAssignableEntitySchema.shape,
  email: z.string().nullable(),
});
export interface DepartmentAssignableUserSchema extends Named<
  typeof departmentAssignableUserSchemaDefinition
> {}
export const departmentAssignableUserSchema: DepartmentAssignableUserSchema =
  departmentAssignableUserSchemaDefinition;
export type DepartmentAssignableUser = z.infer<typeof departmentAssignableUserSchema>;

const departmentAssignmentsSchemaDefinition = z.object({
  users: z.array(departmentAssignableUserSchema),
  teams: z.array(departmentAssignableEntitySchema),
  projects: z.array(departmentAssignableEntitySchema),
});
export interface DepartmentAssignmentsSchema extends Named<
  typeof departmentAssignmentsSchemaDefinition
> {}
export const departmentAssignmentsSchema: DepartmentAssignmentsSchema =
  departmentAssignmentsSchemaDefinition;
export type DepartmentAssignments = z.infer<typeof departmentAssignmentsSchema>;

import { HandledError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";

export class DepartmentNotFoundError extends HandledError {
  constructor() {
    super("department_not_found", "Department not found", { httpStatus: 404 });
  }
}

export class DepartmentAssignmentTargetNotFoundError extends HandledError {
  constructor(readonly target: "user" | "team" | "project") {
    super(
      "department_assignment_target_not_found",
      `Assignment target ${target} not found in this organization`,
      { httpStatus: 404, meta: { target } },
    );
  }
}
const traceDepartmentInputSchemaDefinition = z
  .object({
    hasPrincipalUser: z.boolean(),
    userDepartmentId: z.string().min(1).nullable().optional(),
    userTeamDepartmentId: z.string().min(1).nullable().optional(),
    projectDepartmentId: z.string().min(1).nullable().optional(),
  })
  .strict();
export interface TraceDepartmentInputSchema extends Named<
  typeof traceDepartmentInputSchemaDefinition
> {}
export const traceDepartmentInputSchema: TraceDepartmentInputSchema =
  traceDepartmentInputSchemaDefinition;
export type TraceDepartmentInput = z.infer<typeof traceDepartmentInputSchema>;

export function resolveTraceDepartmentId(input: TraceDepartmentInput): string {
  if (input.hasPrincipalUser) {
    return (
      input.userDepartmentId ||
      input.userTeamDepartmentId ||
      input.projectDepartmentId ||
      UNASSIGNED_DEPARTMENT
    );
  }
  return input.projectDepartmentId || UNASSIGNED_DEPARTMENT;
}
