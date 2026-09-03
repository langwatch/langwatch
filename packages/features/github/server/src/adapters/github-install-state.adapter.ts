import { createHmac, timingSafeEqual } from "node:crypto";
import {
  githubInstallStatePayloadSchema,
  type GithubInstallStatePayload,
} from "@langwatch/github-contract";

import type { GithubRedisPort } from "../ports/github-app-token.port";
import { GithubInstallStatePort } from "../ports/github-install-state.port";

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_MAX_FUTURE_SKEW_MS = 60 * 1000;

export class GithubInstallStateAdapter extends GithubInstallStatePort {
  static create(options: {
    signingKey: string;
    redis: GithubRedisPort | null;
  }): GithubInstallStateAdapter {
    return new GithubInstallStateAdapter(options.signingKey, options.redis);
  }

  private constructor(
    private readonly signingKey: string,
    private readonly redis: GithubRedisPort | null,
  ) {
    super();
  }

  getTtlMs(): number {
    return STATE_TTL_MS;
  }

  async registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      await this.redis.trySet(this.nonceKey(input.nonce), "1", "EX", input.ttlSec);
      return true;
    } catch {
      return false;
    }
  }

  async tryConsumeNonce(nonce: string): Promise<boolean | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const key = this.nonceKey(nonce);
      const deleted = await this.redis.tryGetDelete(key);
      if (deleted !== null) {
        return true;
      }

      const result = await this.redis.tryEval(
        "local v = redis.call('GET', KEYS[1])\nif v then redis.call('DEL', KEYS[1]) return 1 else return 0 end",
        1,
        key,
      );
      if (result !== null) {
        return result === 1 || result === "1";
      }

      const value = await this.redis.tryGet(key);
      if (value === null) {
        return false;
      }

      await this.redis.delete(key);
      return true;
    } catch {
      return null;
    }
  }

  sign(payload: GithubInstallStatePayload): string {
    if (!this.signingKey) {
      throw new Error("CREDENTIALS_SECRET (or NEXTAUTH_SECRET) must be set");
    }

    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.signingKey).update(body).digest("base64url");

    return `${body}.${signature}`;
  }

  tryVerify(token: string | null | undefined): GithubInstallStatePayload | null {
    if (!token) {
      return null;
    }
    if (!this.signingKey) {
      throw new Error("CREDENTIALS_SECRET (or NEXTAUTH_SECRET) must be set");
    }

    const dot = token.indexOf(".");
    if (dot < 0) {
      return null;
    }

    const body = token.slice(0, dot);
    const signature = Buffer.from(token.slice(dot + 1), "base64url");
    const expected = Buffer.from(
      createHmac("sha256", this.signingKey).update(body).digest("base64url"),
      "base64url",
    );
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      return null;
    }

    const payload = this.tryParseBody(body);
    if (!payload) {
      return null;
    }

    const now = Date.now();
    if (now - payload.issuedAt > STATE_TTL_MS) {
      return null;
    }
    if (payload.issuedAt - now > STATE_MAX_FUTURE_SKEW_MS) {
      return null;
    }

    return payload;
  }

  private nonceKey(nonce: string): string {
    return `langy:gh:nonce:${nonce}`;
  }

  private tryParseBody(body: string): GithubInstallStatePayload | null {
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }

    const parsed = githubInstallStatePayloadSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  }
}
