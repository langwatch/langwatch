/**
 * What the install side's suites need to stand in for LangWatch: a key pair to
 * sign with, a license minted with it, and leases in each of the three states
 * a clock can put them in.
 *
 * The key pair is generated per run rather than checked in, so nothing here
 * can be mistaken for a credential.
 */

import { generateKeyPairSync } from "node:crypto";

import { generateLicenseKey } from "../../../licenseGenerationService";
import { licenseTokenFromKey } from "../../../licenseToken";
import { issueLease, type SignedLease } from "../../lease";
import type { ConnectCredential } from "../connectTransport";

export function makeKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}

export const LANGWATCH_KEYS = makeKeyPair();
export const STRANGER_KEYS = makeKeyPair();

export const NOW = new Date("2026-09-19T12:00:00.000Z");
export const ORGANIZATION_ID = "org_connected";

/**
 * A license for 50 full member seats, signed by the LangWatch key pair. It
 * names both hosted services by default, because most suites here are about
 * what a connected install does; a suite about an offline install passes
 * `connectServices: []`.
 */
export function mintLicense({
  maxMembers = 50,
  privateKey = LANGWATCH_KEYS.privateKey,
  connectServices = ["instant_evals", "managed_models"],
  expiresAt = new Date("2027-09-19T12:00:00.000Z"),
}: {
  maxMembers?: number;
  privateKey?: string;
  connectServices?: readonly string[];
  expiresAt?: Date;
} = {}) {
  return generateLicenseKey({
    organizationName: "ACME",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers,
    maxMembersLite: 10,
    expiresAt,
    connectServices,
    privateKey,
    now: NOW,
  });
}

export const LICENSE = mintLicense();

/** A license that names no hosted service: what an offline customer holds. */
export const OFFLINE_LICENSE = mintLicense({ connectServices: [] });

export function credentialOf(
  licenseKey: string,
  instanceId: string = ORGANIZATION_ID,
): ConnectCredential {
  const token = licenseTokenFromKey(licenseKey);
  if (!token) throw new Error("the fixture license has no token");
  return { token, instanceId };
}

/** A lease LangWatch signed for this license and this install. */
export function leaseFor({
  licenseId = LICENSE.licenseData.licenseId,
  instanceId = ORGANIZATION_ID,
  seatOverageAllowance = 5,
  issuedAt = NOW,
  privateKey = LANGWATCH_KEYS.privateKey,
}: {
  licenseId?: string;
  instanceId?: string;
  seatOverageAllowance?: number;
  issuedAt?: Date;
  privateKey?: string;
} = {}): SignedLease {
  return issueLease({
    licenseId,
    instanceId,
    services: ["instant_evals"],
    seatOverageAllowance,
    privateKey,
    now: issuedAt,
  });
}

/** The same lease with its allowance edited after signing. */
export function tamperedLease(lease: SignedLease): SignedLease {
  return {
    ...lease,
    payload: { ...lease.payload, seatOverageAllowance: 5000 },
  };
}
