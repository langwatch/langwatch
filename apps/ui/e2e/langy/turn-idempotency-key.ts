import { createHash } from "node:crypto";

/**
 * One identity per logical send (README.md "langy-agent.ts"). The hash splits
 * same-length sends with different content; the length splits identical
 * queued answers sent at different points.
 */
export const turnIdempotencyKey = ({
  threadId,
  sessionNonce,
  historyLength,
  messages,
}: {
  threadId: string;
  sessionNonce: string;
  historyLength: number;
  messages: unknown[];
}): string => {
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(messages))
    .digest("hex")
    .slice(0, 16);
  return `${threadId}#${sessionNonce}#${historyLength}#${payloadHash}`;
};
