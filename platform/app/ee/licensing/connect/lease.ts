/**
 * The lease a license sync answers with (ADR-139, section 6).
 *
 * A lease is what lets a connected install go over its licensed seats by the
 * agreed allowance, and it expires: when sync stops, the allowance goes with
 * it, on the dates LangWatch signed and not on a timestamp an install could
 * edit. It is signed with the license key pair and verified with the public key
 * the install already embeds, the same way a license is, so an install needs
 * nothing new to trust it.
 *
 * Both sides of the sync import this module: the registry signs, the install
 * verifies. Nothing in here reads a database or the environment.
 */

import crypto from "node:crypto";
import { z } from "zod";
import { normalizePemKey } from "../pem";
import { CONNECT_SERVICES } from "./services";

/** Days after `issuedAt` from which admins are warned that sync is failing. */
export const LEASE_WARN_AFTER_DAYS = 14;
/** Days after `issuedAt` at which the allowance is withdrawn. */
export const LEASE_VALID_DAYS = 30;

export const leasePayloadSchema = z.object({
  licenseId: z.string().min(1),
  instanceId: z.string().min(1),
  services: z.array(z.enum(CONNECT_SERVICES)),
  seatOverageAllowance: z.number().int().min(0),
  issuedAt: z.string().datetime(),
  warnAfter: z.string().datetime(),
  validUntil: z.string().datetime(),
});

export type LeasePayload = z.infer<typeof leasePayloadSchema>;

export const signedLeaseSchema = z.object({
  payload: leasePayloadSchema,
  /** Base64 RSA-SHA256 over `JSON.stringify(payload)`, key order as issued. */
  signature: z.string().min(1),
});

export type SignedLease = z.infer<typeof signedLeaseSchema>;

/** How an install reads a lease against the clock. */
export type LeaseState = "fresh" | "warning" | "expired";

export function issueLease({
  licenseId,
  instanceId,
  services,
  seatOverageAllowance,
  privateKey,
  now,
}: {
  licenseId: string;
  instanceId: string;
  services: LeasePayload["services"];
  seatOverageAllowance: number;
  privateKey: string;
  now: Date;
}): SignedLease {
  const payload: LeasePayload = {
    licenseId,
    instanceId,
    services,
    seatOverageAllowance,
    issuedAt: now.toISOString(),
    warnAfter: daysAfter(now, LEASE_WARN_AFTER_DAYS).toISOString(),
    validUntil: daysAfter(now, LEASE_VALID_DAYS).toISOString(),
  };
  const sign = crypto.createSign("SHA256");
  sign.update(JSON.stringify(payload));
  sign.end();
  return {
    payload,
    signature: sign.sign(normalizePemKey(privateKey), "base64"),
  };
}

/**
 * The lease an install may act on: signed by LangWatch, for this license and
 * this install. Null for anything else, including a lease whose payload was
 * edited after signing.
 */
export function verifyLease({
  lease,
  publicKey,
  licenseId,
  instanceId,
}: {
  lease: unknown;
  publicKey: string;
  licenseId: string;
  instanceId: string;
}): LeasePayload | null {
  const parsed = signedLeaseSchema.safeParse(lease);
  if (!parsed.success) return null;
  const { payload, signature } = parsed.data;
  if (payload.licenseId !== licenseId || payload.instanceId !== instanceId) {
    return null;
  }
  try {
    const verify = crypto.createVerify("SHA256");
    verify.update(JSON.stringify(payload));
    verify.end();
    return verify.verify(normalizePemKey(publicKey), signature, "base64")
      ? payload
      : null;
  } catch {
    return null;
  }
}

/** Where a verified lease stands against the clock. */
export function leaseState(payload: LeasePayload, now: Date): LeaseState {
  if (now >= new Date(payload.validUntil)) return "expired";
  if (now >= new Date(payload.warnAfter)) return "warning";
  return "fresh";
}

function daysAfter(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
