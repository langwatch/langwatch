import { z } from "zod";

/**
 * Coerces a date value (ISO string or epoch number) to epoch milliseconds.
 */
export function coerceToEpoch(value: string | number): number {
  return typeof value === "string" ? Date.parse(value) : value;
}

/**
 * Zod schema that accepts either an epoch number or a valid ISO date string.
 */
export const flexibleDateSchema = z.union([
  z.number(),
  z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
    message: "Invalid date format",
  }),
]);

/**
 * Schema for successful operation responses
 */
export const successSchema = z.object({ success: z.boolean() });

/**
 * Schema for error responses
 */
export const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

/**
 * Schema for unauthorized error responses
 */
export const unauthorizedSchema = errorSchema;

/**
 * Schema for bad request error responses
 */
export const badRequestSchema = errorSchema;

/**
 * Schema for conflict error responses
 */
export const conflictSchema = errorSchema.extend({
  message: z.string(),
});
