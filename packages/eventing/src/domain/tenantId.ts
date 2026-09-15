import { z } from "zod";
import { SecurityError } from "../services/errorHandling.ts";

/**
 * Zod schema for tenant identifiers.
 * Validates that the value is a non-empty string and brands it as TenantId.
 */
export const TenantIdSchema = z
  .string()
  .trim()
  .min(1, "[SECURITY] TenantId must be a non-empty string for tenant isolation")
  .brand<"TenantId">();

/**
 * Branded type for tenant identifiers.
 * This type ensures type safety and prevents mixing tenant IDs with other strings.
 */
export type TenantId = z.infer<typeof TenantIdSchema>;

/**
 * Creates a TenantId from a string, validating it is non-empty.
 * @param value - The string to convert to TenantId
 * @throws {SecurityError} If the value is invalid
 */
export function createTenantId(value: string): TenantId {
  try {
    return TenantIdSchema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Extract the error message from the first issue
      const message =
        error.issues[0]?.message ?? "TenantId must be a non-empty string for tenant isolation";
      throw new SecurityError("createTenantId", message);
    }
    throw error;
  }
}
