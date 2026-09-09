/**
 * The `?langyConversation=<id>` link the command line prints. `/` REPLACES
 * the address and drops the query string, so it must be carried onto the
 * landing destination.
 */

export const LANGY_CONVERSATION_PARAM = "langyConversation";

/**
 * Carry `?langyConversation` from the current address onto a redirect
 * target. Only this one parameter travels — widening would carry auth and
 * switcher params into pages that never expected them.
 */
export function carryLangyConversation({
  destination,
  search,
}: {
  destination: string | null;
  search: string;
}): string | null {
  if (destination === null) return null;
  const conversationId = new URLSearchParams(search).get(LANGY_CONVERSATION_PARAM);
  if (!conversationId) return destination;
  // A destination that already carries the parameter is left alone, so this is
  // safe to apply to a redirect that runs more than once.
  const [path, existing] = destination.split("?", 2);
  const params = new URLSearchParams(existing ?? "");
  if (params.has(LANGY_CONVERSATION_PARAM)) return destination;
  params.set(LANGY_CONVERSATION_PARAM, conversationId);
  return `${path}?${params.toString()}`;
}
