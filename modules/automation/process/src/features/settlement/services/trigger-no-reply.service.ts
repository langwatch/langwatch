import { createHmac } from "node:crypto";

/**
 * The tag of a trigger's no-reply address: notification hides recipients behind
 * `no-reply+<tag>@<sender domain>`, and the HMAC keeps trigger ids unguessable.
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

  tagFor(triggerId: string): string {
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
