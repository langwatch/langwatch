import { z } from "zod";

export const UNASSIGNED_DEPARTMENT = "unassigned" as const;

export const departmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Department = z.infer<typeof departmentSchema>;

export const departmentAssignableEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  departmentId: z.string().nullable(),
});
export type DepartmentAssignableEntity = z.infer<typeof departmentAssignableEntitySchema>;

export const departmentAssignmentsSchema = z.object({
  users: z.array(departmentAssignableEntitySchema),
  teams: z.array(departmentAssignableEntitySchema),
  projects: z.array(departmentAssignableEntitySchema),
});
export type DepartmentAssignments = z.infer<typeof departmentAssignmentsSchema>;

import { HandledError } from "@langwatch/handled-error";

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
export const traceDepartmentInputSchema = z
  .object({
    hasPrincipalUser: z.boolean(),
    userDepartmentId: z.string().min(1).nullable().optional(),
    userTeamDepartmentId: z.string().min(1).nullable().optional(),
    projectDepartmentId: z.string().min(1).nullable().optional(),
  })
  .strict();
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
