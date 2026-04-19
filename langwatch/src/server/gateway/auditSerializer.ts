/**
 * BigInt-safe audit serialiser for Prisma model rows.
 *
 * Plain `JSON.stringify(row)` throws on any BigInt field, which is how the
 * control plane silently lost every VK-mutation audit write for any model
 * carrying a BigInt column (VK.revision, GatewayChangeEvent.revision).
 * Caught via unit test — see virtualKey.service.unit.test.ts.
 *
 * All gateway services that write to `GatewayAuditLog.before` /
 * `GatewayAuditLog.after` should go through this helper instead of reaching
 * for JSON.parse(JSON.stringify(row)) directly — it also keeps the
 * over-the-wire representation (decimal string for BigInt) consistent with
 * `GatewayConfigPayload.revision` so operators see the same shape whether
 * they're inspecting bundles or audit rows.
 */
import type { Prisma } from "@prisma/client";

export function serializeRowForAudit<T extends Record<string, unknown>>(
  row: T,
): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(row, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}
