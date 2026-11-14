/**
 * Which ClickHouse identity sends a statement (ADR-202 Decided 2, 8): a tenant read goes as the
 * app reader; inserts, commands and `SKIP_TENANT_CHECK` statements go as the system.
 * Spec: specs/clickhouse/app-reader-identity.feature
 */

export type ClickHouseIdentity = "reader" | "system";

/** What the client was asked to run, as the refusal names it. */
export type IdentityOperation = "read" | "stream" | "command" | "insert";

/** The identity a statement is sent as; only a read that keeps the tenant check is the reader's. */
export function identityOf({
  operation,
  skipsTenantCheck,
}: {
  operation: IdentityOperation;
  skipsTenantCheck: boolean;
}): ClickHouseIdentity {
  if (operation === "command" || operation === "insert") return "system";
  return skipsTenantCheck ? "system" : "reader";
}

/**
 * A process holding no system credential (the api once its inserts moved to the worker, Decided
 * 12) was asked for a statement only the system identity sends. The plain default; a process
 * supplies its handled twin through {@link SystemIdentityAbsentErrorFactory}.
 */
export class SystemIdentityAbsentError extends Error {
  readonly code = "clickhouse_system_identity_absent";

  constructor(
    readonly operation: IdentityOperation,
    readonly table: string | undefined,
  ) {
    super(
      `This process holds no ClickHouse system credential, so it refuses the ${operation} on ` +
        `"${table ?? "unknown"}". Inserts, commands and SKIP_TENANT_CHECK statements run only ` +
        "in a process configured with the system identity.",
    );
    this.name = "SystemIdentityAbsentError";
  }
}

/** Builds the handled refusal for a statement only the system identity sends; plain by default. */
export abstract class SystemIdentityAbsentErrorFactory {
  abstract create(input: { operation: IdentityOperation; table: string | undefined }): unknown;
}
