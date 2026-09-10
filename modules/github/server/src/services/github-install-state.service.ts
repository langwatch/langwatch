import { createHmac, timingSafeEqual } from "node:crypto";
import {
  githubInstallStatePayloadSchema,
  type GithubInstallStatePayload,
} from "@langwatch/github-contract";

import { GithubInstallState } from "../app/github.members.ts";
import type { GithubInstallNonceRepository } from "../repositories/github-install-nonce.repository.ts";
import { nowInstant } from "@langwatch/time";

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_MAX_FUTURE_SKEW_MS = 60 * 1000;

/**
 * The install state a popup carries: an HMAC over the payload, verified within
 * a ten-minute window, and the one-shot nonce beside it that a replayed Setup
 * URL cannot spend twice.
 */
export class GithubInstallStateService implements GithubInstallState {
  static create(options: {
    signingKey: string;
    nonces: GithubInstallNonceRepository;
  }): GithubInstallStateService {
    return new GithubInstallStateService(options.signingKey, options.nonces);
  }

  private constructor(
    private readonly signingKey: string,
    private readonly nonces: GithubInstallNonceRepository,
  ) {
  }

  getTtlMs(): number {
    return STATE_TTL_MS;
  }

  registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean> {
    return this.nonces.registerNonce(input);
  }

  tryConsumeNonce(nonce: string): Promise<boolean | null> {
    return this.nonces.consumeNonce(nonce);
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

    const now = nowInstant().epochMilliseconds;
    if (now - payload.issuedAt > STATE_TTL_MS) {
      return null;
    }
    if (payload.issuedAt - now > STATE_MAX_FUTURE_SKEW_MS) {
      return null;
    }

    return payload;
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
