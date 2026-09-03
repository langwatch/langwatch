/**
 * Reading a Postgres unique-constraint violation out of a driver error.
 *
 * Two experiment writes race on the same unique index — the slug within a
 * project, and the experiment id — and both recover by retrying rather than
 * failing, so both have to recognise the collision. That means knowing
 * P2002 and where the driver puts the column names, which is adapter work:
 * the shape below is Prisma's, and it differs between the classic client and
 * the driver adapter, which is why `targets` looks in two places.
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

export class PostgresUniqueConflict {
  static matches(error: unknown): boolean {
    return uniqueConflictSchema.safeParse(error).success;
  }

  /** The columns the collision was on, or none if the driver did not say. */
  static targets(error: unknown): string[] {
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
}
