/**
 * The one-time reveal: a secret parked under an id, served exactly once.
 *
 * A virtual key secret exists in plaintext at the moment the key is minted.
 * A create that must hand it to someone other than its caller (the Langy
 * panel, after the CLI or the tour minted the key) stashes it here and hands
 * out the reveal id instead. The id can travel through a conversation, a
 * brief or a tool call: reading it is what serves the secret, and the read
 * deletes it. The secret is encrypted at rest with the credentials key.
 *
 * Redis holds the reveal for a day. A second read finds the marker the first
 * one left behind, so it is told apart from a reveal that expired or never
 * existed. Without Redis the store is an in-process map, so a dev instance
 * running with SKIP_REDIS still completes the flow.
 *
 * Spec: specs/langy/langy-secret-snippet.feature
 */
import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { tryGetApp } from "~/server/app-layer/app";
import { decrypt, encrypt } from "~/utils/encryption";
import {
  SecretAlreadyRevealedError,
  SecretRevealExpiredError,
} from "./oneTimeReveal.errors";

const logger = createLogger("langwatch:secrets:one-time-reveal");

/** How long a reveal waits to be read, and how long its marker outlives it. */
export const ONE_TIME_REVEAL_TTL_MS = 24 * 60 * 60 * 1000;

export const ONE_TIME_REVEAL_KINDS = ["virtual_key"] as const;
export type OneTimeRevealKind = (typeof ONE_TIME_REVEAL_KINDS)[number];

export interface StashInput {
  organizationId: string;
  kind: OneTimeRevealKind;
  /** The row the secret belongs to, for the log line and the marker. */
  keyId: string;
  /** What the masked render shows in place of the secret, never the secret. */
  preview: string;
  secret: string;
}

export interface RevealedSecret {
  kind: OneTimeRevealKind;
  keyId: string;
  preview: string;
  secret: string;
}

interface StoredReveal {
  kind: OneTimeRevealKind;
  keyId: string;
  preview: string;
  /** The secret, encrypted with the credentials key. */
  sealed: string;
}

function secretKey(organizationId: string, revealId: string): string {
  return `secret_reveal:${organizationId}:${revealId}`;
}

function markerKey(organizationId: string, revealId: string): string {
  return `secret_revealed:${organizationId}:${revealId}`;
}

/** Redis below 6.2 has no GETDEL; the server rejecting it is the only signal. */
function isUnknownCommandError(error: unknown): boolean {
  const message = (error as { message?: string })?.message;
  return typeof message === "string" && /unknown command/i.test(message);
}

/** The in-process store for an instance without Redis. */
const memorySecrets = new Map<string, { value: string; expiresAt: number }>();
const memoryMarkers = new Map<string, number>();

/** For tests: forget every reveal the memory store holds. */
export function resetOneTimeRevealMemoryStore(): void {
  memorySecrets.clear();
  memoryMarkers.clear();
}

export class OneTimeRevealService {
  constructor(
    private readonly redis: RedisConnection | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  static create(): OneTimeRevealService {
    return new OneTimeRevealService(tryGetApp()?.redis ?? null);
  }

  /** Parks the secret and returns the id that reads it once. */
  async stash(input: StashInput): Promise<{ revealId: string }> {
    const revealId = `rvl_${nanoid(24)}`;
    const stored: StoredReveal = {
      kind: input.kind,
      keyId: input.keyId,
      preview: input.preview,
      sealed: encrypt(input.secret),
    };
    const key = secretKey(input.organizationId, revealId);
    const value = JSON.stringify(stored);
    if (this.redis) {
      await this.redis.set(key, value, "PX", ONE_TIME_REVEAL_TTL_MS);
    } else {
      memorySecrets.set(key, {
        value,
        expiresAt: this.now() + ONE_TIME_REVEAL_TTL_MS,
      });
    }
    logger.info(
      {
        organizationId: input.organizationId,
        kind: input.kind,
        keyId: input.keyId,
      },
      "Stashed a secret for a one-time reveal",
    );
    return { revealId };
  }

  /**
   * Serves the secret and forgets it. The second read of the same id is
   * refused as already revealed; an id with nothing behind it, because it
   * expired or was never stashed, is refused as expired.
   */
  async reveal({
    organizationId,
    revealId,
  }: {
    organizationId: string;
    revealId: string;
  }): Promise<RevealedSecret> {
    const key = secretKey(organizationId, revealId);
    const marker = markerKey(organizationId, revealId);
    const raw = this.redis
      ? await this.takeFromRedis(key)
      : this.takeFromMemory(key);
    if (raw === null) {
      const revealed = this.redis
        ? (await this.redis.exists(marker)) > 0
        : this.markerInMemory(marker);
      if (revealed) throw new SecretAlreadyRevealedError(revealId);
      throw new SecretRevealExpiredError(revealId);
    }
    if (this.redis) {
      await this.redis.set(marker, "1", "PX", ONE_TIME_REVEAL_TTL_MS);
    } else {
      memoryMarkers.set(marker, this.now() + ONE_TIME_REVEAL_TTL_MS);
    }
    const stored = JSON.parse(raw) as StoredReveal;
    logger.info(
      { organizationId, kind: stored.kind, keyId: stored.keyId },
      "Served a one-time reveal",
    );
    return {
      kind: stored.kind,
      keyId: stored.keyId,
      preview: stored.preview,
      secret: decrypt(stored.sealed),
    };
  }

  private async takeFromRedis(key: string): Promise<string | null> {
    const redis = this.redis!;
    try {
      // GETDEL keeps read-and-delete atomic, so two reads racing on the same
      // id cannot both be served.
      return await redis.getdel(key);
    } catch (error) {
      if (!isUnknownCommandError(error)) throw error;
    }
    const value = await redis.get(key);
    if (value !== null) await redis.del(key);
    return value;
  }

  private takeFromMemory(key: string): string | null {
    const entry = memorySecrets.get(key);
    memorySecrets.delete(key);
    if (!entry || entry.expiresAt <= this.now()) return null;
    return entry.value;
  }

  private markerInMemory(marker: string): boolean {
    const expiresAt = memoryMarkers.get(marker);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.now()) {
      memoryMarkers.delete(marker);
      return false;
    }
    return true;
  }
}
