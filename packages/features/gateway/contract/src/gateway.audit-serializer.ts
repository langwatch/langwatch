/**
 * BigInt-safe audit serialiser for Prisma model rows. Plain `JSON.stringify(row)` throws on any
 * BigInt field, which is how the control plane silently lost every VK-mutation audit write for
 * any model carrying a BigInt column (VK.revision, GatewayChangeEvent.revision).
 */
import { z } from "zod";

const gatewayAuditJsonSchema = z.json();

export type GatewayAuditJson = z.infer<typeof gatewayAuditJsonSchema>;

export function serializeRowForAudit<T extends Record<string, unknown>>(row: T): GatewayAuditJson {
  const serialised = JSON.stringify(row, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return gatewayAuditJsonSchema.parse(JSON.parse(serialised));
}
