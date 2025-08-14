import { z } from "zod";

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
