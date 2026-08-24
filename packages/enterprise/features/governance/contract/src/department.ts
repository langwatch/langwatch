import { z } from "zod";

export const UNASSIGNED_DEPARTMENT = "unassigned" as const;
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
