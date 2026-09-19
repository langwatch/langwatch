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

/** A license for 50 full member seats, signed by the LangWatch key pair. */
export function mintLicense({
  maxMembers = 50,
  privateKey = LANGWATCH_KEYS.privateKey,
}: {
  maxMembers?: number;
  privateKey?: string;
} = {}) {
  return generateLicenseKey({
    organizationName: "ACME",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers,
    maxMembersLite: 10,
    expiresAt: new Date("2027-09-19T12:00:00.000Z"),
    privateKey,
    now: NOW,
  });
}

export const LICENSE = mintLicense();

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
