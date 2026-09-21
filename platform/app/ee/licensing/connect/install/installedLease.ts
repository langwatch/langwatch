/**
 * The lease this install may act on (ADR-139, section 6).
 *
 * A lease is only ever the one LangWatch signed for this license and this
 * install: a payload edited after signing, a lease naming another license, and
 * a lease naming another instance all read as no lease at all, so the plain
 * licensed seat count applies. Where it stands against the clock comes from
 * the two dates inside the signed payload, never from a timestamp in this
 * database.
 *
 * Both the seat allowance in the resolved plan and the sync section of
 * Settings, Connect read a lease through here, so the two can not disagree
 * about which lease counts or when it runs out.
 */

import { parseLicenseKey } from "../../validation";
import {
  type LeasePayload,
  type LeaseState,
  leaseState,
  verifyLease,
} from "../lease";
import { readConnectConfig } from "./connectConfig";

export interface InstalledLease {
  readonly payload: LeasePayload;
  readonly state: LeaseState;
}

/**
 * The identity this install presents to LangWatch: the organization id unless
 * an operator named one. The same id the gateway calls carry, because the
 * registry binds a license to one instance.
 */
export function installInstanceId(organizationId: string): string {
  return readConnectConfig().instanceIdOverride ?? organizationId;
}

/** The verified lease behind a stored license, or null where there is none. */
export function readInstalledLease({
  licenseKey,
  lease,
  instanceId,
  publicKey,
  now,
}: {
  licenseKey: string;
  lease: unknown;
  instanceId: string;
  publicKey: string;
  now: Date;
}): InstalledLease | null {
  if (lease === null || lease === undefined) return null;

  const signedLicense = parseLicenseKey(licenseKey);
  if (!signedLicense) return null;

  const payload = verifyLease({
    lease,
    publicKey,
    licenseId: signedLicense.data.licenseId,
    instanceId,
  });
  if (!payload) return null;

  return { payload, state: leaseState(payload, now) };
}

/** The seats a lease adds, while it still applies. */
export function seatAllowanceOf(lease: InstalledLease | null): number {
  if (!lease || lease.state === "expired") return 0;
  return lease.payload.seatOverageAllowance;
}
