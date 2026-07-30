import { z } from "zod";

/**
 * A tenancy invariant was violated. Thrown by the guard below, and by a store
 * asserting that a record it is about to write belongs to the tenant it was
 * handed. Not a `HandledError`: nothing a caller can act on, and the message is
 * a diagnostic for a log line rather than copy for a customer.
 */
export class SecurityError extends Error {
  override readonly name = "SecurityError";
  readonly operation: string;
  readonly tenantId?: string;
  readonly context: Record<string, unknown>;

  constructor(
    operation: string,
    message: string,
    tenantId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(`[SECURITY] ${message}`);
    this.operation = operation;
    this.tenantId = tenantId;
    this.context = { ...context, operation, tenantId };
  }
}

const tenantIdSchema = z
  .string()
  .trim()
  .min(1, "TenantId must be a non-empty string for tenant isolation");

/**
 * Every ClickHouse read and write filters on the tenant first, because no other
 * identifier in the schema is unique across tenants (ADR-109 decision 5). This
 * is the guard that refuses a query built without one — a missing tenant is a
 * cross-tenant read waiting for an id collision, not a validation nicety.
 */
export function validateTenantId(
  context: { tenantId?: string } | undefined,
  operation: string,
): void {
  if (!context) {
    throw new SecurityError(
      operation,
      `${operation} requires a context with tenantId for tenant isolation`,
    );
  }
  if (!context.tenantId) {
    throw new SecurityError(
      operation,
      `${operation} requires a tenantId for tenant isolation`,
    );
  }
  const result = tenantIdSchema.safeParse(context.tenantId);
  if (!result.success) {
    throw new SecurityError(
      operation,
      result.error.issues[0]?.message ??
        "TenantId must be a non-empty string for tenant isolation",
      context.tenantId,
    );
  }
}
