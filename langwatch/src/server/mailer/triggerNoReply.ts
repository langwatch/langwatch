import { createHmac } from "crypto";
import { env } from "../../env.mjs";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch:mailer:triggerNoReply");

/**
 * Build the To: address used on outbound trigger emails. We don't put the real
 * recipients in the To header — they go in BCC. This achieves three things at
 * once:
 *
 *   1. Recipient privacy. With multiple recipients in To/Cc, every receiver
 *      sees the rest of the list. Trigger emails are sent to whoever the
 *      automation author configured; that list is internal.
 *   2. Reply-all containment. Replies to a no-reply address go to the bit
 *      bucket (or a bounce handler) instead of fanning out to every recipient
 *      in the original list.
 *   3. Header-injection blast-radius. `emailActionParamsSchema` already
 *      rejects CRLF-smuggling shapes in the recipient list, but moving
 *      recipients off the To header means the only string interpolated into
 *      the To header is one we control entirely (the hashed no-reply).
 *
 * The local part includes a short HMAC of the trigger id, salted with
 * NEXTAUTH_SECRET, so the address is:
 *
 *   - Stable per trigger — useful for bounce attribution downstream.
 *   - Unguessable without the secret — anyone harvesting To addresses can't
 *     reverse-engineer trigger ids or forge "looks like one of ours" replies.
 *
 * Test fires use a sentinel id so they don't pollute bounce streams that
 * production bounce-processors might key off the hash.
 */

const HMAC_BYTES = 6;

function shortHash(triggerId: string): string {
  const secret = env.NEXTAUTH_SECRET ?? "";
  if (!secret) {
    logger.warn(
      "NEXTAUTH_SECRET is not set; no-reply trigger tags are forgeable and not unguessable. Set NEXTAUTH_SECRET to secure trigger email addresses."
    );
  }
  return createHmac("sha256", secret)
    .update(triggerId)
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);
}

function domainOf(defaultFrom: string): string {
  const match = defaultFrom.match(/<[^@]+@([^>]+)>/);
  return match?.[1]?.trim() || "langwatch.ai";
}

export function buildTriggerNoReplyAddress({
  defaultFrom,
  triggerId,
}: {
  defaultFrom: string;
  triggerId: string;
}): string {
  const domain = domainOf(defaultFrom);
  const tag = shortHash(triggerId);
  return `LangWatch Triggers <no-reply+${tag}@${domain}>`;
}

export const TEST_FIRE_TRIGGER_ID_SENTINEL = "preview";
