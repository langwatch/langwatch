import { createHmac, timingSafeEqual } from "node:crypto";

import {
  type BraidSignature,
  type BraidSignatureFailureReason,
  type BraidSignatureVerdict,
  braidSignatureMessage,
  parseBraidSignature,
  SIGNING_KEY_LOOKUP_CACHE_MS,
  SIGNING_KEY_PREFIX,
  type VerifyBraidSignatureInput,
} from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";

import type { SigningKeyUsageRepository } from "../repositories/signing-key-usage.repository.ts";
import type {
  SigningKeyCredential,
  SigningKeyRepository,
} from "../repositories/signing-key.repository.ts";
import { signingKeyUsageHourOf, signingKeyVerifiesAt } from "../rules/signing-key.rules.ts";

const logger = createLogger("langwatch:api-key:braid-signature");
/** Counts and last use are written at most this often from one process. */
export const SIGNING_KEY_USAGE_FLUSH_MS = 10_000;
/** The most lookups held at once; past it the oldest goes, costing one early re-read. */
const SIGNING_KEY_LOOKUP_MAX_HELD = 10_000;

type HeldLookup = {
  readonly at: number;
  readonly credential: Promise<SigningKeyCredential | undefined>;
};
type PendingUsage = {
  readonly organizationId: string;
  readonly keyId: string;
  readonly hour: number;
  passed: number;
  failed: number;
  lastUsedAt: Instant;
};

/**
 * Verifies a span's `langwatch.signature` (ADR-185 §4) without the secret leaving this module.
 * A key, or its absence, is held for `SIGNING_KEY_LOOKUP_CACHE_MS`; each verdict on a known key
 * is counted in memory and written every `SIGNING_KEY_USAGE_FLUSH_MS`, never once per span.
 */
export class BraidSignatureVerificationService {
  readonly #lookups = new Map<string, HeldLookup>();
  readonly #pending = new Map<string, PendingUsage>();
  #flushTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    private readonly keys: Pick<SigningKeyRepository, "findCredentials" | "markUsed">,
    private readonly usage: Pick<SigningKeyUsageRepository, "add">,
    private readonly now: () => Instant,
  ) {}

  static create(input: {
    keys: Pick<SigningKeyRepository, "findCredentials" | "markUsed">;
    usage: Pick<SigningKeyUsageRepository, "add">;
    now?: () => Instant;
  }): BraidSignatureVerificationService {
    return new BraidSignatureVerificationService(input.keys, input.usage, input.now ?? nowInstant);
  }

  async verify(input: VerifyBraidSignatureInput): Promise<BraidSignatureVerdict> {
    const signature = parseBraidSignature({ attribute: input.signature });
    if (!signature) return { outcome: "failed", reason: "malformed" };
    const publicId = signature.kid;
    let credential: SigningKeyCredential | undefined;
    try {
      credential = await this.#lookup({ organizationId: input.organizationId, publicId });
    } catch (error) {
      logger.warn({ error, publicId }, "signing key lookup failed; the span stays unverified");
      return { outcome: "unavailable" };
    }
    if (!credential) return { outcome: "failed", reason: "unknown_key", publicId };

    const at = this.now().epochMilliseconds;
    const reason = BraidSignatureVerificationService.failureOf({
      credential,
      signature,
      input,
      at,
    });
    this.#count({
      organizationId: input.organizationId,
      keyId: credential.id,
      passed: !reason,
      at: this.now(),
    });
    if (reason) return { outcome: "failed", reason, publicId };
    return { outcome: "verified", signingProjectId: credential.projectId, keys: signature.keys };
  }

  /** Drops a held lookup, so a revoke on this server ends the key here at once. */
  forget({ organizationId, publicId }: { organizationId: string; publicId: string }): void {
    this.#lookups.delete(`${organizationId}:${publicId}`);
  }

  /** Writes what this process has counted since the last write. */
  async flush(): Promise<void> {
    if (this.#flushTimer !== undefined) clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    if (pending.length === 0) return;
    const lastUse = new Map<string, { ids: string[]; at: Instant }>();
    for (const entry of pending) {
      const held = lastUse.get(entry.organizationId) ?? { ids: [], at: entry.lastUsedAt };
      held.ids.push(entry.keyId);
      if (entry.lastUsedAt.epochMilliseconds > held.at.epochMilliseconds)
        held.at = entry.lastUsedAt;
      lastUse.set(entry.organizationId, held);
    }
    try {
      await this.usage.add({
        usage: pending.map(({ keyId, hour, passed, failed }) => ({ keyId, hour, passed, failed })),
      });
      for (const [organizationId, { ids, at }] of lastUse) {
        await this.keys.markUsed({ organizationId, ids: [...new Set(ids)], at });
      }
    } catch (error) {
      logger.warn({ error }, "recording signing key usage failed, non-fatal");
    }
  }

  #lookup({
    organizationId,
    publicId,
  }: {
    organizationId: string;
    publicId: string;
  }): Promise<SigningKeyCredential | undefined> {
    const cacheKey = `${organizationId}:${publicId}`;
    const at = this.now().epochMilliseconds;
    const held = this.#lookups.get(cacheKey);
    if (held && at - held.at < SIGNING_KEY_LOOKUP_CACHE_MS) return held.credential;

    const credential = this.keys
      .findCredentials({ organizationId, publicId })
      .then(([found]) => found);
    this.#lookups.delete(cacheKey);
    if (this.#lookups.size >= SIGNING_KEY_LOOKUP_MAX_HELD) {
      const oldest = this.#lookups.keys().next();
      if (!oldest.done) this.#lookups.delete(oldest.value);
    }
    this.#lookups.set(cacheKey, { at, credential });
    credential.catch(() => {
      if (this.#lookups.get(cacheKey)?.credential === credential) this.#lookups.delete(cacheKey);
    });
    return credential;
  }

  #count(input: { organizationId: string; keyId: string; passed: boolean; at: Instant }): void {
    const hour = signingKeyUsageHourOf({ at: input.at.epochMilliseconds });
    const slot = `${input.keyId}:${hour}`;
    const held = this.#pending.get(slot) ?? {
      organizationId: input.organizationId,
      keyId: input.keyId,
      hour,
      passed: 0,
      failed: 0,
      lastUsedAt: input.at,
    };
    if (input.passed) held.passed += 1;
    else held.failed += 1;
    if (input.at.epochMilliseconds > held.lastUsedAt.epochMilliseconds) held.lastUsedAt = input.at;
    this.#pending.set(slot, held);
    if (this.#flushTimer === undefined) {
      this.#flushTimer = setTimeout(() => void this.flush(), SIGNING_KEY_USAGE_FLUSH_MS);
      this.#flushTimer.unref?.();
    }
  }

  private static failureOf({
    credential,
    signature,
    input,
    at,
  }: {
    credential: SigningKeyCredential;
    signature: BraidSignature;
    input: VerifyBraidSignatureInput;
    at: number;
  }): BraidSignatureFailureReason | undefined {
    const signed: Record<string, string> = {};
    for (const key of signature.keys) {
      const value = input.entries[key];
      if (value === undefined) return "malformed";
      signed[key] = value;
    }
    const message = braidSignatureMessage({ traceId: input.traceId, entries: signed });
    if (message.kind === "malformed") return "malformed";
    if (credential.revokedAt !== null) return "revoked";
    if (!signingKeyVerifiesAt({ key: credential, at })) return "expired";

    const hmacKey = `${SIGNING_KEY_PREFIX}${credential.publicId}_${credential.secret}`;
    const expected = createHmac("sha256", hmacKey).update(message.text, "utf8").digest();
    const given = Buffer.from(signature.sig, "base64url");
    return given.length === expected.length && timingSafeEqual(given, expected)
      ? undefined
      : "bad_signature";
  }
}
