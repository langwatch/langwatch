// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  DigestLinkInvalidError,
  DigestLinkNotFoundError,
  type DigestUnsubscribePage,
} from "@langwatch/enterprise-digest-contract";
import { generate } from "@langwatch/ksuid";
import { z } from "zod";

import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type { DigestSendRepository } from "../repositories/digest-send.repository.ts";

/** What a token signs: an unsubscribe names a person and a send, a click a send and a link key. */
const tokenPayloadSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("u"), u: z.string().min(1), s: z.string().min(1) }),
  z.object({ t: z.literal("c"), s: z.string().min(1), k: z.string().min(1) }),
]);
type TokenPayload = z.infer<typeof tokenPayloadSchema>;

/**
 * The digest's signed links (ADR-031's format: `base64url(JSON).hex(HMAC)`, compared in constant
 * time). A click token never carries its address: the redirect reads it from the send's row.
 */
export class DigestLinkService {
  static create(deps: {
    secret: string | undefined;
    sends: DigestSendRepository;
    audience: DigestAudienceRepository;
    now: () => number;
  }): DigestLinkService {
    return new DigestLinkService(deps);
  }

  private constructor(
    private readonly deps: {
      secret: string | undefined;
      sends: DigestSendRepository;
      audience: DigestAudienceRepository;
      now: () => number;
    },
  ) {}

  unsubscribeToken({ userId, sendId }: { userId: string; sendId: string }): string {
    return this.#sign({ t: "u", u: userId, s: sendId });
  }

  clickToken({ sendId, linkKey }: { sendId: string; linkKey: string }): string {
    return this.#sign({ t: "c", s: sendId, k: linkKey });
  }

  async readUnsubscribe({ token }: { token: string }): Promise<DigestUnsubscribePage> {
    const { u } = this.#unsubscribePayload(token);
    const unsubscribed = await this.deps.audience.listUnsubscribed({ userIds: [u] });
    return { subscribed: unsubscribed.length === 0 };
  }

  async unsubscribe({ token }: { token: string }): Promise<void> {
    const { u, s } = this.#unsubscribePayload(token);
    await this.deps.audience.unsubscribe({ userId: u, sendId: s, at: this.deps.now() });
  }

  async resubscribe({ token }: { token: string }): Promise<void> {
    const { u } = this.#unsubscribePayload(token);
    await this.deps.audience.resubscribe({ userId: u });
  }

  /** Records the click and answers the address the send stored under the token's key. */
  async followLink({ token }: { token: string }): Promise<string> {
    const payload = this.#verified(token);
    if (payload.t !== "c") throw new DigestLinkInvalidError();
    const [send] = await this.deps.sends.findById({ id: payload.s });
    const target = send?.links[payload.k];
    if (!send || target === undefined) throw new DigestLinkNotFoundError(payload.k);
    await this.deps.sends.recordClick({
      id: generate("dgc").toString(),
      sendId: send.id,
      linkKey: payload.k,
      at: this.deps.now(),
    });
    return target;
  }

  #unsubscribePayload(token: string): Extract<TokenPayload, { t: "u" }> {
    const payload = this.#verified(token);
    if (payload.t !== "u") throw new DigestLinkInvalidError();
    return payload;
  }

  #sign(payload: TokenPayload): string {
    const serialized = JSON.stringify(payload);
    return `${Buffer.from(serialized).toString("base64url")}.${this.#signature(serialized)}`;
  }

  #verified(token: string): TokenPayload {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) throw new DigestLinkInvalidError();
    const serialized = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
    const provided = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.#signature(serialized));
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(new Uint8Array(provided), new Uint8Array(expected))
    ) {
      throw new DigestLinkInvalidError();
    }
    const parsed = tokenPayloadSchema.safeParse(this.#json(serialized));
    if (!parsed.success) throw new DigestLinkInvalidError();
    return parsed.data;
  }

  #json(serialized: string): unknown {
    try {
      return JSON.parse(serialized);
    } catch {
      return null;
    }
  }

  #signature(serialized: string): string {
    // An empty key would make every link forgeable: refuse rather than sign or verify with one.
    if (!this.deps.secret) throw new Error("The session secret is not set; digest links refused.");
    return createHmac("sha256", this.deps.secret).update(serialized).digest("hex");
  }
}
