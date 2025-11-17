/**
 * Branded type for tenant identifiers.
 * This type ensures type safety and prevents mixing tenant IDs with other strings.
 */
export type TenantId = string & { readonly __brand: "TenantId" };

/**
 * Creates a TenantId from a string value.
 * This function validates that the value is a non-empty string.
 *
 * @param value - The string value to convert to a TenantId
 * @returns A TenantId branded type
 * @throws {Error} If the value is empty or not a string
 */
export function createTenantId(value: string): TenantId {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      "[SECURITY] TenantId must be a non-empty string for tenant isolation",
    );
  }
  return value as TenantId;
}
