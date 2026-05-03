/**
 * CliSessionInventoryService — read + revoke per-user CLI device-flow
 * sessions. Mirrors the macOS "Logged-in Devices" pattern: every active
 * session shows up as a device card with hostname, platform, last-used,
 * and a per-row revoke button.
 *
 * Storage model: each CLI session has 1 access token (1h TTL) + 1
 * refresh token (30d TTL) tracked in Redis. The per-user index
 * `lwcli:user:<userId>:tokens` (maintained by `auth-cli.ts /exchange`
 * + `/refresh`) lists every Redis key the user owns. Reads SMEMBERS
 * the index, MGETs the records, and groups them by
 * `client_info.session_started_at` to fold rotated access tokens
 * under their parent session.
 *
 * Revoke is a per-session op (delete the access + refresh tokens
 * matching one session_started_at). The existing
 * `CliTokenRevocationService.revokeForUser` is the user-wide revoke
 * (Phase 1B.5); this service adds the per-session granularity.
 *
 * Spec: specs/ai-governance/sessions/sessions-inventory.feature
 */
import type { Cluster, Redis } from "ioredis";

import { connection as defaultRedisConnection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";

import { CliTokenRevocationService } from "./cliTokenRevocation.service";

const logger = createLogger("langwatch:cli-session-inventory");

type RedisLike = Redis | Cluster;

export interface CliSession {
  /**
   * Stable session identifier. When `client_info.session_started_at`
   * is present, it's the unix-ms of the original /exchange. For
   * pre-Phase-8 sessions without that field, falls back to the
   * earliest `issued_at` we can find in the user's tokens.
   */
  sessionStartedAtMs: number;
  /** Friendly device label or "Unknown device". */
  deviceLabel: string;
  /** os.hostname() from the CLI machine. */
  hostname: string | null;
  /** os.userInfo().username from the CLI machine. */
  uname: string | null;
  /** "darwin" / "linux" / "win32". */
  platform: string | null;
  /** Latest issued_at among the access/refresh tokens we found. */
  lastSeenMs: number;
  /** Refresh-token TTL ceiling. */
  expiresAtMs: number;
  /**
   * Tokens belonging to this session (access + refresh). The revoke
   * path deletes these from Redis + scrubs them from the per-user
   * index.
   */
  tokenKeys: string[];
}

interface AccessOrRefreshRecord {
  user_id: string;
  organization_id: string;
  issued_at: number;
  expires_at: number;
  client_info?: {
    device_label?: string;
    hostname?: string;
    uname?: string;
    platform?: string;
    session_started_at?: number;
  };
}

export class CliSessionInventoryService {
  constructor(private readonly redis: RedisLike | undefined) {}

  static create(
    redis: RedisLike | undefined = defaultRedisConnection,
  ): CliSessionInventoryService {
    return new CliSessionInventoryService(redis);
  }

  async listForUser({
    userId,
  }: {
    userId: string;
  }): Promise<CliSession[]> {
    if (!this.redis) {
      logger.warn(
        { userId },
        "CliSessionInventoryService.listForUser: Redis unavailable, returning empty list",
      );
      return [];
    }
    const indexKey = CliTokenRevocationService.userTokensIndexKey(userId);
    const memberKeys = await this.redis.smembers(indexKey);
    if (memberKeys.length === 0) return [];

    // Bucket tokens by session_started_at (or by issued_at fallback for
    // pre-Phase-8 records). Each bucket = one logical session even when
    // the access token has been rotated multiple times.
    const buckets = new Map<number, {
      tokenKeys: string[];
      records: AccessOrRefreshRecord[];
    }>();

    for (const memberKey of memberKeys) {
      const raw = await this.redis.get(memberKey);
      if (!raw) {
        // Stale index entry — token TTL'd out without the index getting
        // cleaned up. Skip silently; revoke-all paths will handle cleanup.
        continue;
      }
      let record: AccessOrRefreshRecord;
      try {
        record = JSON.parse(raw) as AccessOrRefreshRecord;
      } catch {
        // Malformed token record. Treat as stale, skip.
        continue;
      }
      const sessionAnchor =
        record.client_info?.session_started_at ?? record.issued_at;
      const bucket = buckets.get(sessionAnchor) ?? {
        tokenKeys: [],
        records: [],
      };
      bucket.tokenKeys.push(memberKey);
      bucket.records.push(record);
      buckets.set(sessionAnchor, bucket);
    }

    const sessions: CliSession[] = [];
    for (const [sessionStartedAtMs, bucket] of buckets) {
      // Pick the freshest record's client_info — it'll have the latest
      // device_label even if the user re-labelled mid-session.
      const fresh = bucket.records.reduce((a, b) =>
        a.issued_at >= b.issued_at ? a : b,
      );
      const lastSeenMs = bucket.records.reduce(
        (max, r) => (r.issued_at > max ? r.issued_at : max),
        0,
      );
      const expiresAtMs = bucket.records.reduce(
        (max, r) => (r.expires_at > max ? r.expires_at : max),
        0,
      );
      sessions.push({
        sessionStartedAtMs,
        deviceLabel: deriveDeviceLabel(fresh.client_info),
        hostname: fresh.client_info?.hostname ?? null,
        uname: fresh.client_info?.uname ?? null,
        platform: fresh.client_info?.platform ?? null,
        lastSeenMs,
        expiresAtMs,
        tokenKeys: bucket.tokenKeys,
      });
    }

    // Most-recently-active first.
    return sessions.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
  }

  /**
   * Revoke a single session by its sessionStartedAtMs. Deletes every
   * access + refresh token belonging to that session and scrubs them
   * from the per-user index. Other sessions for the same user are
   * untouched.
   */
  async revokeSession({
    userId,
    sessionStartedAtMs,
  }: {
    userId: string;
    sessionStartedAtMs: number;
  }): Promise<{ revokedTokens: number }> {
    if (!this.redis) {
      return { revokedTokens: 0 };
    }
    const sessions = await this.listForUser({ userId });
    const target = sessions.find(
      (s) => s.sessionStartedAtMs === sessionStartedAtMs,
    );
    if (!target) {
      return { revokedTokens: 0 };
    }

    let revokedTokens = 0;
    for (const tokenKey of target.tokenKeys) {
      const deleted = await this.redis.del(tokenKey);
      if (deleted > 0) revokedTokens += deleted;
    }
    // SREM the revoked keys from the per-user index. Leaving them as
    // dead members is harmless but the index would grow unbounded
    // across many rotations + revokes.
    const indexKey = CliTokenRevocationService.userTokensIndexKey(userId);
    if (target.tokenKeys.length > 0) {
      // SREM accepts variadic keys; cluster-safe since we operate on a
      // single SET key.
      await this.redis.srem(indexKey, ...target.tokenKeys);
    }
    return { revokedTokens };
  }
}

function deriveDeviceLabel(
  info: AccessOrRefreshRecord["client_info"],
): string {
  if (!info) return "Unknown device";
  if (info.device_label && info.device_label.trim().length > 0) {
    return info.device_label.trim();
  }
  // Build a sensible fallback from hostname + platform.
  const platformPretty = prettifyPlatform(info.platform);
  const host = info.hostname?.trim();
  if (host && platformPretty) return `${platformPretty} (${host})`;
  if (host) return host;
  if (platformPretty) return platformPretty;
  return "Unknown device";
}

function prettifyPlatform(platform: string | undefined): string | null {
  if (!platform) return null;
  switch (platform.toLowerCase()) {
    case "darwin":
      return "Mac";
    case "linux":
      return "Linux";
    case "win32":
    case "windows":
      return "Windows";
    default:
      return platform;
  }
}
