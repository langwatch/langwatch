import { createHmac } from "node:crypto";

/**
 * The `To:` address every automation email is sent to.
 *
 * The real recipients ride in BCC, and this hashed no-reply is the only string
 * interpolated into the To header. That buys three things at once:
 *
 *   1. Recipient privacy. With several addresses in To or Cc every receiver
 *      sees the rest of the list, and that list is the customer's internal
 *      business.
 *   2. Reply-all containment. A reply to a no-reply address goes to a bounce
 *      handler instead of fanning out to everyone on the original.
 *   3. Header-injection blast radius. The recipient list is free-form JSON;
 *      moving it off the To header means the header is built entirely from
 *      values we control.
 *
 * The local part carries a short HMAC of the automation id, salted with the
 * injected signing key, so the address is stable per automation (useful for
 * bounce attribution) and best-effort unguessable.
 *
 * Unlike the unsubscribe token, an absent key DEGRADES rather than refuses.
 * This tag carries no authority — recipients are in BCC, the To header is a
 * public no-reply, and a forged tag grants nothing — so an empty key costs the
 * unguessability property and nothing else. Blocking every automation email
 * over it would be the larger harm; the caller is told instead, by warning.
 *
 * The application's copy is `platform/app/src/server/mailer/triggerNoReply.ts`
 * and stays frozen while both exist. The address is stable per automation, so
 * a bounce processor keyed on the hash reads mail from either process the same
 * way only while the two agree.
 */

/** Bytes of HMAC in the local part, rendered as twice as many hex characters. */
const HMAC_BYTES = 6;

/** Test fires use this id so they never pollute a bounce stream keyed on the hash. */
export const TEST_FIRE_TRIGGER_ID_SENTINEL = "preview";

/** Reports an absent signing key. Never carries the key or the address. */
export abstract class TriggerNoReplyWarningPort {
  abstract unguessabilityUnavailable(message: string): void;
}

export class TriggerNoReplyService {
  static create(input: {
    /** Injected signing key. Absent or empty degrades unguessability, never blocks. */
    secret: string | undefined;
    warnings?: TriggerNoReplyWarningPort;
  }): TriggerNoReplyService {
    return new TriggerNoReplyService(input.secret, input.warnings);
  }

  private constructor(
    private readonly secret: string | undefined,
    private readonly warnings: TriggerNoReplyWarningPort | undefined,
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
 * The sender domain, taken from the configured default `from`.
 *
 * A deployment that wrote its default from as a bare address rather than
 * `Name <local@domain>` has no domain to read, and `langwatch.ai` is what the
 * application has always fallen back to. Changing the fallback would change
 * the To header of every self-hosted deployment's automation mail.
 */
function domainOf(defaultFrom: string): string {
  const match = defaultFrom.match(/<[^@]+@([^>]+)>/);

  return match?.[1]?.trim() || "langwatch.ai";
}
