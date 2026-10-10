import { randomUUID } from "node:crypto";

import { Prisma } from "./generated/client.ts";

// Per process and unguessable; held on the global so a reloaded copy of this module agrees.
const NONCE = Symbol.for("langwatch.prisma-client.skip-tenant-check");
const holder = globalThis as { [NONCE]?: string };
holder[NONCE] ??= randomUUID();
const MARKER = `/* SKIP_TENANT_CHECK ${holder[NONCE]} */`;

/**
 * Lets one raw statement through the tenant guard without a tenant predicate. Interpolate it
 * into the SQL (`.sql` for an `Unsafe` string); a comment directly above the flag gives the
 * reason (`langwatch/skip-tenant-check-reason`). Every skip is counted and logged.
 */
export function skipTenantCheck(flag: { SKIP_TENANT_CHECK: true }): Prisma.Sql {
  return flag.SKIP_TENANT_CHECK ? Prisma.raw(MARKER) : Prisma.empty;
}

/** Whether a raw statement's text carries the marker {@link skipTenantCheck} made. */
export function skipsTenantCheck(sql: string): boolean {
  return sql.includes(MARKER);
}
