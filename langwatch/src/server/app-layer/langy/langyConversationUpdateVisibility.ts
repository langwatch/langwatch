/**
 * User-scoping gate for the Langy conversation freshness broadcast.
 *
 * The freshness reactor (`langyConversationUpdateBroadcast.reactor.ts`) publishes
 * on the tenant-wide (project) broadcast channel, so every project member's SSE
 * subscription receives every conversation's signal locally. That is only safe
 * once each subscription drops the signals the subscriber is not allowed to see:
 * a Langy conversation is private to its owner unless it has been shared with the
 * project. This predicate is the per-event authorization gate the subscription
 * applies before yielding to the browser.
 *
 * It mirrors the read authorization in `LangyConversationService.getById`
 * (`row.userId !== userId && !row.isShared` → not visible) EXACTLY, so the
 * real-time signal never reaches a browser that the read routes would refuse.
 * `isShared` means "visible to the whole project", which is why it cannot be
 * expressed by an owner-keyed emitter and must be evaluated per event.
 *
 * Fail-closed: an unparseable payload, or one missing the owner identity, is
 * treated as NOT visible. Nothing leaks when we cannot prove access.
 */
export interface LangyConversationUpdateAuthFields {
  /** The conversation owner's user id (fold `UserId`). */
  ownerUserId?: unknown;
  /** Whether the conversation has been shared with the project (fold `IsShared`). */
  isShared?: unknown;
}

/**
 * Decide whether a subscribing user may receive a freshness signal, given the
 * signal's already-parsed owner/share fields.
 */
export function canUserSeeLangyConversationUpdate({
  ownerUserId,
  isShared,
  userId,
}: LangyConversationUpdateAuthFields & { userId: string }): boolean {
  if (isShared === true) return true;
  if (typeof ownerUserId !== "string" || ownerUserId.length === 0) return false;
  return ownerUserId === userId;
}

/**
 * Parse a raw broadcast payload string and decide visibility in one step — the
 * exact operation the `onConversationUpdate` subscription performs per event.
 * Fail-closed on any malformed input.
 */
export function isLangyConversationUpdateVisibleToUser({
  eventPayload,
  userId,
}: {
  eventPayload: unknown;
  userId: string;
}): boolean {
  if (typeof eventPayload !== "string") return false;
  let parsed: LangyConversationUpdateAuthFields;
  try {
    parsed = JSON.parse(eventPayload) as LangyConversationUpdateAuthFields;
  } catch {
    return false;
  }
  return canUserSeeLangyConversationUpdate({
    ownerUserId: parsed.ownerUserId,
    isShared: parsed.isShared,
    userId,
  });
}
