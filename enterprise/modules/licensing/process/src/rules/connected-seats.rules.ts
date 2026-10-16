/**
 * The seats a customer's registry rows add up to: what billing invoices and what Ops
 * shows. Only standard licences count; a testing licence holds no seats (ADR-180).
 */

import type { ConnectedSeats, LicenseSeatChange } from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";

import type { IssuedLicenseRecord } from "../repositories/issued-license.repository.ts";
import { isStandardLicenseRow, statusOfIssuedLicense } from "./issued-license.rules.ts";

/** Every seat change that raised a linked license, as billing invoices it. */
export function seatChangesOf(rows: readonly IssuedLicenseRecord[]): LicenseSeatChange[] {
  return rows.flatMap((row) =>
    isStandardLicenseRow(row) && row.organizationId !== null && row.seatsRaisedFrom !== null
      ? [
          {
            licenseRowId: row.id,
            organizationId: row.organizationId,
            previousSeats: row.seatsRaisedFrom,
            seats: row.maxMembers,
            changedAt: row.issuedAt.toString(),
          },
        ]
      : [],
  );
}

/**
 * Off the active license that runs longest: a reissue leaves both rows active
 * until the install presents the new one, and summing them counts seats twice.
 */
export function connectedSeatsOf({
  rows,
  now,
}: {
  rows: readonly IssuedLicenseRecord[];
  now: Instant;
}): ConnectedSeats {
  const licenses = rows.filter(isStandardLicenseRow);
  const active = licenses.filter((row) => statusOfIssuedLicense(row, now) === "active");
  const [current] = active.toSorted((a, b) => Temporal.Instant.compare(b.expiresAt, a.expiresAt));
  const [lastSyncAt] = active
    .flatMap((row) => (row.lastSyncAt ? [row.lastSyncAt] : []))
    .toSorted((a, b) => Temporal.Instant.compare(b, a));

  return {
    licensed: current?.maxMembers ?? 0,
    reported: current?.lastSyncAt ? (current.reportedMembers ?? 0) : null,
    lastSyncAt: lastSyncAt?.toString() ?? null,
    managedVirtualKeyId: licenses.find((row) => row.virtualKeyId)?.virtualKeyId ?? null,
  };
}
