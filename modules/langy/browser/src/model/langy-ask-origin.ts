/**
 * Where the open conversation's first question was asked, so the next question from the same
 * place continues it. `conversationId` is null until that question's turn names the conversation.
 * @see modules/dashboard/specs/dashboards-v2.feature (AC264e, AC264f)
 */

import { LANGY_FOLLOW_UP_WINDOW_MS } from "@langwatch/langy-contract";

export type LangyAskOrigin = { from: string; conversationId: string | null; at: number };

/** Whether a question asked from `askedFrom` now goes into the open conversation. */
export function continuesAskOrigin({
  origin,
  askedFrom,
  activeConversationId,
  now,
}: {
  origin: LangyAskOrigin | null;
  askedFrom: string | undefined;
  activeConversationId: string | null;
  now: number;
}): boolean {
  if (!origin || askedFrom === void 0 || origin.from !== askedFrom) return false;
  if (activeConversationId === null || origin.conversationId !== activeConversationId) return false;
  return now - origin.at < LANGY_FOLLOW_UP_WINDOW_MS;
}

/** The origin once a turn named its conversation; an origin already bound stays as it is. */
export function boundAskOrigin({
  origin,
  conversationId,
}: {
  origin: LangyAskOrigin | null;
  conversationId: string;
}): LangyAskOrigin | null {
  return origin && origin.conversationId === null ? { ...origin, conversationId } : origin;
}
