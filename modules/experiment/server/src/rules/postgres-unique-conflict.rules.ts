/**
 * Reading a Postgres unique-constraint violation out of a driver error.
 */

import { z } from "zod";

const uniqueConflictSchema = z.object({
  code: z.literal("P2002"),
  meta: z
    .object({
      target: z.union([z.string(), z.array(z.string())]).optional(),
      driverAdapterError: z
        .object({
          cause: z
            .object({
              constraint: z
                .object({
                  fields: z.array(z.string()).optional(),
                  index: z.string().optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

export function isPostgresUniqueConflict(error: unknown): boolean {
  return uniqueConflictSchema.safeParse(error).success;
}

/** The columns the collision was on, or none if the driver did not say. */
export function postgresUniqueConflictTargets(error: unknown): string[] {
  const parsed = uniqueConflictSchema.safeParse(error);
  if (!parsed.success) return [];

  const target = parsed.data.meta?.target;
  if (Array.isArray(target)) {
    return target.map(String);
  }

  if (typeof target === "string") {
    return [target];
  }

  const constraint = parsed.data.meta?.driverAdapterError?.cause?.constraint;
  if (!constraint) return [];
  if (constraint.fields) {
    return constraint.fields.map(String);
  }

  return constraint.index ? [constraint.index] : [];
}
