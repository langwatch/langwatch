// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  DigestLinkInvalidError,
  DigestLinksUnavailableError,
  type DigestTokenCall,
  DigestUnsubscribeRateLimitedError,
} from "@langwatch/enterprise-digest-contract";
import { createLogger } from "@langwatch/observability";
import type { UserApi } from "@langwatch/user-contract";
import { z } from "zod";

import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type { DigestCallCounterRepository } from "../repositories/digest-call-counter.repository.ts";

const logger = createLogger("langwatch:digest");

/**
 * What an unsubscribe token signs: the person, the send whose link it rode in, and when it
 * stops working (epoch seconds, as ADR-031's `exp`).
 */
const tokenPayloadSchema = z.object({
  u: z.string().min(1),
  s: z.string().min(1),
  exp: z.number().int(),
});
type TokenPayload = z.infer<typeof tokenPayloadSchema>;

/** How long a link keeps working after it is minted: automation's ADR-031 lifetime. */
export const LINK_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

/**
 * Signed ahead of the payload and never sent: the session secret also signs automation's links,
 * so the purpose keeps a token minted for one from verifying as the other.
 */
const SIGNED_PURPOSE = "digest.v1:";

/** The attempts window and each action's cap in it: automation's unsubscribe pair, same values. */
export const ATTEMPT_WINDOW_SECONDS = 60;
export const ATTEMPT_LIMITS = { resolve: 30, "one-click": 10, resubscribe: 10 } as const;

type Deps = Readonly<{
  /** The session secret; absent or empty, no token is signed or accepted. */
  secret: string | undefined;
  /** Counts attempts per caller, so one caller's attempts at the public pages are capped. */
  limits: DigestCallCounterRepository;
  audience: Pick<DigestAudienceRepository, "findUnsubscribed" | "unsubscribe" | "resubscribe">;
  /** Whether the person a link names still exists; a link for no one is an invalid link. */
  users: Pick<UserApi, "findById">;
  now: () => number;
}>;

/**
 * The one-click unsubscribe (RFC 8058) and its page. The token (ADR-031's HMAC format) is the
 * whole authorization, so it names one person and does nothing else; each call counts an attempt
 * before reading anything, and a link naming a person who no longer exists writes no row.
 */
export class DigestUnsubscribeService {
  static create(deps: Deps): DigestUnsubscribeService {
    return new DigestUnsubscribeService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  token({ userId, sendId }: { userId: string; sendId: string }): string {
    const exp = Math.floor(this.deps.now() / 1000) + LINK_LIFETIME_SECONDS;
    const serialized = JSON.stringify({ u: userId, s: sendId, exp } satisfies TokenPayload);
    return `${Buffer.from(serialized).toString("base64url")}.${this.#signature(serialized)}`;
  }

  async isSubscribed({ token, callerAddress }: DigestTokenCall): Promise<boolean> {
    await this.#countAttempt({ action: "resolve", callerAddress });
    const { u } = await this.#existing(token);
    return (await this.deps.audience.findUnsubscribed({ userIds: [u] })).length === 0;
  }

  async unsubscribe({ token, callerAddress }: DigestTokenCall): Promise<void> {
    await this.#countAttempt({ action: "one-click", callerAddress });
    const { u, s } = await this.#existing(token);
    await this.deps.audience.unsubscribe({ userId: u, sendId: s, at: this.deps.now() });
  }

  async resubscribe({ token, callerAddress }: DigestTokenCall): Promise<void> {
    await this.#countAttempt({ action: "resubscribe", callerAddress });
    const { u } = await this.#existing(token);
    await this.deps.audience.resubscribe({ userId: u });
  }

  /**
   * One attempt at the public pages, counted before the token is checked or anything is read.
   * A caller with no address shares one bucket: a missing address must still throttle.
   */
  async #countAttempt({
    action,
    callerAddress,
  }: {
    action: keyof typeof ATTEMPT_LIMITS;
    callerAddress: string | null;
  }): Promise<void> {
    let limit: Awaited<ReturnType<DigestCallCounterRepository["count"]>>;
    try {
      limit = await this.deps.limits.count({
        key: `digest-unsubscribe:${action}:${callerAddress ?? "unknown"}`,
        windowSeconds: ATTEMPT_WINDOW_SECONDS,
        max: ATTEMPT_LIMITS[action],
      });
    } catch (error) {
      // Unsubscribing is a legal obligation: a down counter must not stop it.
      logger.warn({ error, action }, "the digest attempt counter failed; allowing the attempt");
      return;
    }
    if (!limit.allowed) throw new DigestUnsubscribeRateLimitedError();
  }

  /** The verified payload, only while its person exists; the user is read after the signature. */
  async #existing(token: string): Promise<TokenPayload> {
    const payload = this.#verified(token);
    if (!(await this.deps.users.findById({ id: payload.u }))) throw new DigestLinkInvalidError();
    return payload;
  }

  #verified(token: string): TokenPayload {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) throw new DigestLinkInvalidError();
    const serialized = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
    const provided = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.#signature(serialized));
    // timingSafeEqual throws on unequal lengths, so the length is checked first.
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(new Uint8Array(provided), new Uint8Array(expected))
    ) {
      throw new DigestLinkInvalidError();
    }
    const parsed = tokenPayloadSchema.safeParse(parseJson(serialized));
    if (!parsed.success || this.deps.now() >= parsed.data.exp * 1000) {
      throw new DigestLinkInvalidError();
    }
    return parsed.data;
  }

  #signature(serialized: string): string {
    // An empty key would make every link forgeable: refuse rather than sign or verify with one.
    if (!this.deps.secret) throw new DigestLinksUnavailableError();
    return createHmac("sha256", this.deps.secret)
      .update(`${SIGNED_PURPOSE}${serialized}`)
      .digest("hex");
  }
}

function parseJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}
