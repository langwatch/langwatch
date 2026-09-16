import { createHmac } from "node:crypto";

/**
 * No-reply To: address using BCC for recipients: protects privacy, prevents
 * reply-all spam, and prevents header injection via HMAC-hashed local part.
 */

/** Bytes of HMAC in the local part, rendered as twice as many hex characters. */
const HMAC_BYTES = 6;

/** Reports an absent signing key. Never carries the key or the address. */
export abstract class TriggerNoReplyWarning {
  abstract unguessabilityUnavailable(message: string): void;
}

export class TriggerNoReplyService {
  static create(input: {
    /** Injected signing key. Absent or empty degrades unguessability, never blocks. */
    secret: string | undefined;
    warnings?: TriggerNoReplyWarning;
  }): TriggerNoReplyService {
    return new TriggerNoReplyService(input.secret, input.warnings);
  }

  private constructor(
    private readonly secret: string | undefined,
    private readonly warnings: TriggerNoReplyWarning | undefined,
  ) {}

  addressFor(input: { defaultFrom: string; triggerId: string }): string {
    const domain = domainOf(input.defaultFrom);
    const tag = this.tag(input.triggerId);

    return `LangWatch Triggers <no-reply+${tag}@${domain}>`;
  }

  private tag(triggerId: string): string {
    const secret = this.secret ?? "";
    if (!secret) {
      this.warnings?.unguessabilityUnavailable(
        "NEXTAUTH_SECRET is not set; no-reply trigger tags are forgeable and not unguessable. Set NEXTAUTH_SECRET to secure trigger email addresses.",
      );
    }

    return createHmac("sha256", secret)
      .update(triggerId)
      .digest("hex")
      .slice(0, HMAC_BYTES * 2);
  }
}

/**
 * The sender domain, from the configured default `from`. A bare address
 * has no domain to read, so `langwatch.ai` is the fallback -- changing it
 * breaks every self-hosted deployment's automation mail To header.
 */
function domainOf(defaultFrom: string): string {
  const match = defaultFrom.match(/<[^@]+@([^>]+)>/);

  return match?.[1]?.trim() || "langwatch.ai";
}
