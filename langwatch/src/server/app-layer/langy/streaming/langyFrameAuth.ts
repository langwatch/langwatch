/**
 * Langy authenticated frame contract (LANGY_WORKER_REDESIGN_PLAN.md §0a).
 *
 * Every frame the worker streams back to the control plane carries a per-frame
 * HMAC proving BOTH who it is and that it really is who it says. The Go worker
 * SIGNS; this module (in the Hono relay) VERIFIES. The wire contract is pinned
 * cross-language by specs/langy/langy-frame-auth.vectors.json — a Go test and
 * the test beside this file both reproduce those MACs, so the two languages can
 * never silently diverge.
 *
 * Key (`runToken`): a 32-byte per-conversation secret minted at
 * `conversation_started`, stored server-only (never in a client-facing
 * projection — see the PendingHandoffToken precedent), injected into the worker
 * at spawn, and NEVER sent back on the wire. The HMAC proves possession without
 * ever re-transmitting it.
 *
 * Construction (unambiguous by length-prefixing — an attacker cannot shift a
 * byte across a field boundary to forge a colliding tuple):
 *
 *   signingInput = concat, over [projectId, userId, conversationId, turnId,
 *                  frameNonce, payload] in that fixed order, of
 *                  uint32BE(utf8ByteLength(field)) ‖ utf8(field)
 *   mac          = hex( HMAC-SHA256( key = hexDecode(runToken), signingInput ) )
 *
 * Replay is closed OUTSIDE this module (the relay checks `turnId` against the
 * in-flight turn and dedups `frameNonce` via a shared Redis SET); this module is
 * only the crypto: sign, verify, mint, and generate a nonce.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The stable identity every frame is bound to. */
export interface LangyFrameIdentity {
  projectId: string;
  userId: string;
  conversationId: string;
  turnId: string;
}

/** The signed-over material: identity + this frame's nonce + its exact payload bytes. */
export interface LangyFrameSigned extends LangyFrameIdentity {
  /** 16 random bytes, hex — unique per frame; the relay dedups on it. */
  frameNonce: string;
  /**
   * The exact payload string the worker serialised and signed. Verification
   * re-signs THESE bytes verbatim — the relay must not re-serialise before
   * checking, or a lossless round-trip difference would break the MAC.
   */
  payload: string;
}

/** A frame on the wire: the signed material plus its MAC. */
export interface LangyFrameEnvelope extends LangyFrameSigned {
  /** hex HMAC-SHA256 over the length-prefixed signing input. */
  mac: string;
}

/** The fixed field order the signing input concatenates. Order is part of the contract. */
const SIGNED_FIELDS: Array<keyof LangyFrameSigned> = [
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
 * Verify a frame's MAC in constant time. Returns false — never throws — on a
 * mismatch, a malformed MAC, or a bad runToken, so a hostile caller learns only
 * pass/fail. This is authenticity only: `turnId`-is-in-flight and
 * `frameNonce`-unseen are the relay's checks, not this function's.
 */
export function verifyFrame(runToken: string, frame: LangyFrameEnvelope): boolean {
  const expected = Buffer.from(computeFrameMac(runToken, frame), "hex");
  const got = macBytes(frame.mac);
  if (got === null || got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

/**
 * Decode a hex MAC to bytes, rejecting anything that is not exactly a lowercase
 * (or uppercase) 64-hex-char SHA-256 digest. `Buffer.from(x, "hex")` silently
 * truncates on stray characters, so we validate the shape first rather than
 * trust a partial decode.
 */
function macBytes(mac: string): Buffer | null {
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
