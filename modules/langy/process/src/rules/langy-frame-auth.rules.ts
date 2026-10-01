import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type {
  LangyFrameEnvelope,
  LangyFrameIdentity,
  LangyFrameSigned,
} from "../app/langy.members.ts";

/** Langy authenticated frame contract (specs/langy/langy-frame-auth.vectors.json).
 * Per-frame HMAC proves identity (Go worker signs, Hono relay verifies). Key (runToken) is
 * 32-byte per-conversation secret, server-only, never on wire. Construction: length-prefixed
 * concat of [projectId, userId, conversationId, turnId, frameNonce, payload] via HMAC-SHA256. */

/** The fixed field order the signing input concatenates. Order is part of the contract. */
const SIGNED_FIELDS: (keyof LangyFrameSigned)[] = [
  "projectId",
  "userId",
  "conversationId",
  "turnId",
  "frameNonce",
  "payload",
];

/**
 * Length-prefixed concatenation of the signed fields: for each field,
 * uint32-BE(byteLength) followed by the UTF-8 bytes. The length prefix is what
 * makes the concatenation injective.
 */
function signingInput(frame: LangyFrameSigned): Buffer {
  const chunks: Buffer[] = [];
  for (const name of SIGNED_FIELDS) {
    const bytes = Buffer.from(frame[name], "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length, 0);
    chunks.push(len, bytes);
  }
  return Buffer.concat(chunks);
}

/**
 * Compute the frame MAC. `runToken` is the 32-byte secret as hex; the HMAC key
 * is its decoded bytes.
 */
export function computeFrameMac(runToken: string, frame: LangyFrameSigned): string {
  const key = Buffer.from(runToken, "hex");
  return createHmac("sha256", key).update(signingInput(frame)).digest("hex");
}

/** Sign a frame: mint a fresh nonce and attach the MAC. (Mirrors the Go signer.) */
export function signFrame(
  runToken: string,
  identity: LangyFrameIdentity,
  payload: string,
): LangyFrameEnvelope {
  const signed: LangyFrameSigned = {
    ...identity,
    frameNonce: newFrameNonce(),
    payload,
  };
  return { ...signed, mac: computeFrameMac(runToken, signed) };
}

/**
 * Verify a frame's MAC in constant time. Returns false — never throws — on
 * a mismatch, malformed MAC, or bad runToken, so a hostile caller learns
 * only pass/fail. Authenticity only; in-flight/unseen checks are the relay's.
 */
export function verifyFrame(runToken: string, frame: LangyFrameEnvelope): boolean {
  const expected = Buffer.from(computeFrameMac(runToken, frame), "hex");
  const got = decodeMacBytes(frame.mac);
  if (got === null || got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

/**
 * Decode a hex MAC to bytes, rejecting anything not exactly a 64-hex-char
 * SHA-256 digest. `Buffer.from(x, "hex")` silently truncates on stray
 * characters, so the shape is validated first rather than trusting a partial decode.
 */
function decodeMacBytes(mac: string): Buffer | null {
  if (typeof mac !== "string" || !/^[0-9a-fA-F]{64}$/.test(mac)) return null;
  return Buffer.from(mac, "hex");
}

/** Mint a per-conversation runToken: 32 bytes of CSPRNG, hex-encoded (64 chars). */
export function mintRunToken(): string {
  return randomBytes(32).toString("hex");
}

/** A fresh per-frame nonce: 16 bytes of CSPRNG, hex-encoded (32 chars). */
export function newFrameNonce(): string {
  return randomBytes(16).toString("hex");
}
