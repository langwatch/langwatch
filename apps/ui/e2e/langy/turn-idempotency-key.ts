/**
 * One identity per logical send: the same for a framework replay of that send,
 * new once the session nonce is renewed (see README.md "langy-agent.ts").
 */
export const turnIdempotencyKey = ({
  threadId,
  sessionNonce,
  historyLength,
}: {
  threadId: string;
  sessionNonce: string;
  historyLength: number;
}): string => `${threadId}#${sessionNonce}#${historyLength}`;
