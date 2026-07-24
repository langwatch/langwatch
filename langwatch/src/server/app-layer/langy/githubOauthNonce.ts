/**
 * Single-use nonce store for the Langy GitHub App install round-trip. The nonce
 * is signed into the state at /install and burned at /setup so a captured
 * callback URL can't be replayed. Redis-backed; when Redis is unavailable the
 * caller falls back to the signature + session-rebind defenses (the signed
 * `nonceRegistered` flag records which mode applied). Issue #4747.
 */
import { connection } from "~/server/redis";

function nonceKey(nonce: string): string {
  return `langy:gh:nonce:${nonce}`;
}

/**
 * Register a nonce. Returns `true` when Redis stored it (the nonce is
 * authoritative), `false` when Redis is unavailable (caller skips the check).
 */
export async function registerGithubInstallNonce(
  nonce: string,
  ttlSec: number,
): Promise<boolean> {
  if (!connection) return false;
  try {
    await (
      connection as {
        set: (k: string, v: string, mode: string, ttl: number) => Promise<string>;
      }
    ).set(nonceKey(nonce), "1", "EX", ttlSec);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically consume a nonce. Returns `true` if present and consumed, `false`
 * if missing (already used / never issued), or `null` when Redis is
 * unavailable (caller skips the check).
 */
export async function consumeGithubInstallNonce(
  nonce: string,
): Promise<boolean | null> {
  if (!connection) return null;
  try {
    const conn = connection as {
      getdel?: (k: string) => Promise<string | null>;
      eval?: (
        script: string,
        numKeys: number,
        ...args: string[]
      ) => Promise<number | string | null>;
      get: (k: string) => Promise<string | null>;
      del: (k: string) => Promise<number>;
    };
    const key = nonceKey(nonce);
    if (typeof conn.getdel === "function") {
      const v = await conn.getdel(key);
      return v !== null;
    }
    if (typeof conn.eval === "function") {
      const result = await conn.eval(
        "local v = redis.call('GET', KEYS[1])\nif v then redis.call('DEL', KEYS[1]) return 1 else return 0 end",
        1,
        key,
      );
      return result === 1 || result === "1";
    }
    const v = await conn.get(key);
    if (v === null) return false;
    await conn.del(key);
    return true;
  } catch {
    return null;
  }
}
