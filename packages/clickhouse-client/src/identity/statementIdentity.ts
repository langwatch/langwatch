/**
 * Which ClickHouse identity sends a statement (ADR-202 Decided 2, 8, 12): a tenant read as the
 * app reader; commands and skip-check statements as the system; an insert as the system, or as
 * the writer where no system is held. Spec: specs/clickhouse/app-{reader,writer}-identity.feature
 */

export type ClickHouseIdentity = "reader" | "system" | "writer";

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
 * The identity an insert leaves on: the system where the process holds it, else the writer
 * (ADR-202 Decided 12). The writer is never chosen for a read or a command.
 */
export function insertIdentityOf({
  holdsSystem,
  holdsWriter,
}: {
  holdsSystem: boolean;
  holdsWriter: boolean;
}): Exclude<ClickHouseIdentity, "reader"> | undefined {
  if (holdsSystem) return "system";
  return holdsWriter ? "writer" : undefined;
}

/**
 * A process holding no system credential (the api, Decided 14) was asked for a statement only
 * the system identity sends, or for an insert while it holds no writer either. The plain
 * default; a process supplies its handled twin through {@link SystemIdentityAbsentErrorFactory}.
 */
export class SystemIdentityAbsentError extends Error {
  readonly code = "clickhouse_system_identity_absent";

  constructor(
    readonly operation: IdentityOperation,
    readonly table: string | undefined,
  ) {
    super(
      `This process holds no ClickHouse system credential, so it refuses the ${operation} on ` +
        `"${table ?? "unknown"}". Commands and SKIP_TENANT_CHECK statements run only in a ` +
        "process configured with the system identity; inserts with the system or the writer.",
    );
    this.name = "SystemIdentityAbsentError";
  }
}

/** Builds the handled refusal for a statement only the system identity sends; plain by default. */
export abstract class SystemIdentityAbsentErrorFactory {
  abstract create(input: { operation: IdentityOperation; table: string | undefined }): unknown;
}
