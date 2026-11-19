// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  DigestLinkInvalidError,
  DigestLinksUnavailableError,
} from "@langwatch/enterprise-digest-contract";
import { z } from "zod";

import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";

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

type Deps = Readonly<{
  /** The session secret; absent or empty, no token is signed or accepted. */
  secret: string | undefined;
  audience: Pick<DigestAudienceRepository, "listUnsubscribed" | "unsubscribe" | "resubscribe">;
  now: () => number;
}>;

/**
 * The digest's one-click unsubscribe (RFC 8058) and the page behind its link. Tokens use
 * ADR-031's format, `base64url(JSON).hex(HMAC-SHA256)` with an `exp`, the HMAC taken over
 * `digest.v1:` and the JSON, compared in constant time; the token is the whole authorization,
 * so it names one person and nothing else can be done with it. Without a secret every call
 * refuses with `digest_links_unavailable`.
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

  async isSubscribed({ token }: { token: string }): Promise<boolean> {
    const { u } = this.#verified(token);
    return (await this.deps.audience.listUnsubscribed({ userIds: [u] })).length === 0;
  }

  async unsubscribe({ token }: { token: string }): Promise<void> {
    const { u, s } = this.#verified(token);
    await this.deps.audience.unsubscribe({ userId: u, sendId: s, at: this.deps.now() });
  }

  async resubscribe({ token }: { token: string }): Promise<void> {
    const { u } = this.#verified(token);
    await this.deps.audience.resubscribe({ userId: u });
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
