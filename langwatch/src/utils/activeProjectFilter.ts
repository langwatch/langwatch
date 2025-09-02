import { type Prisma } from "@prisma/client";

/**
 * Helper function to create a where clause that excludes archived projects.
 * This ensures consistent filtering across all project queries.
 *
 * @param additionalWhere - Optional additional where conditions to merge
 * @returns A where clause object that excludes archived projects
 */
export function activeProjectWhere(
  additionalWhere?: Prisma.ProjectWhereInput
): Prisma.ProjectWhereInput {
  return {
    ...additionalWhere,
    archivedAt: null,
  };
}

/**
 * Helper function to merge active project filtering with existing where conditions.
 * This is useful when you already have a where object and want to add the archived filter.
 *
 * @param existingWhere - The existing where conditions
 * @returns A merged where clause that excludes archived projects
 */
export function mergeActiveProjectWhere(
  existingWhere: Prisma.ProjectWhereInput
): Prisma.ProjectWhereInput {
  return {
    ...existingWhere,
    archivedAt: null,
  };
}
