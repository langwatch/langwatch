import { z } from "zod";

/**
 * Schema for successful operation responses
 */
export const successSchema = z.object({ success: z.boolean() });

/**
 * Schema for error responses
 */
export const errorSchema = z.object({ error: z.string() });

/**
 * Schema for unauthorized error responses
 */
export const unauthorizedSchema = z.object({
  error: z.string(),
});

/**
 * Schema for bad request error responses
 */
export const badRequestSchema = z.object({
  error: z.string(),
});
