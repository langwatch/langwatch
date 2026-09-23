/**
 * What a registry row says on its own (ADR-156): the status derived from it,
 * how it reads once it leaves the feature, and how a duplicate is recognised
 * whichever client reported it.
 */

import type {
  IssuedLicenseStatus,
  IssuedLicenseView,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";

import type { IssuedLicenseRecord } from "../repositories/issued-license.repository.ts";

/** Revoked wins over superseded, which wins over the term. */
export function statusOfIssuedLicense(
  row: Pick<IssuedLicenseRecord, "revokedAt" | "supersededAt" | "expiresAt">,
  now: Instant,
): IssuedLicenseStatus {
  if (row.revokedAt) return "revoked";
  if (row.supersededAt) return "superseded";
  if (Temporal.Instant.compare(now, row.expiresAt) >= 0) return "expired";
  return "active";
}

/** The derived status, the held license dropped, and every instant on the wire. */
export function issuedLicenseView({
  row,
  now,
}: {
  row: IssuedLicenseRecord;
  now: Instant;
}): IssuedLicenseView {
  const { pendingDeliveryLicense, ...stored } = row;
  return {
    ...stored,
    issuedAt: stored.issuedAt.toString(),
    expiresAt: stored.expiresAt.toString(),
    revokedAt: stored.revokedAt?.toString() ?? null,
    supersededAt: stored.supersededAt?.toString() ?? null,
    instanceBoundAt: stored.instanceBoundAt?.toString() ?? null,
    lastSyncAt: stored.lastSyncAt?.toString() ?? null,
    createdAt: stored.createdAt.toString(),
    updatedAt: stored.updatedAt.toString(),
    status: statusOfIssuedLicense(row, now),
    hasPendingDelivery: pendingDeliveryLicense !== null,
  };
}

/** Prisma's unique constraint violation, without importing Prisma here. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Whether a unique violation is the one on this column. Where the constraint is
 * reported moves with the client, and all of them spell the column.
 */
export function violationNames({ error, column }: { error: unknown; column: string }): boolean {
  if (!isUniqueViolation(error)) return false;
  const { meta } = error as { meta?: unknown };
  if (meta === undefined) return false;
  try {
    return JSON.stringify(meta)?.includes(column) ?? false;
  } catch {
    return false;
  }
}
