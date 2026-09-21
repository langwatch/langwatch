/**
 * The `?langyConversation=<id>` link the command line prints.
 *
 * `langwatch langy --share-control` says "Follow along at
 * <origin>/?langyConversation=<id>", and repeats it on every permission ask.
 * Root is the only link the command line can build, because it knows the
 * conversation and not the project the reader will land in.
 *
 * `/` resolves the reader's home and REPLACES the address with it, which drops
 * the query string — so the parameter has to be carried onto that destination
 * or it never reaches a page where the panel is mounted.
 *
 * Spec: specs/langy/langy-local-control.feature.
 */

export const LANGY_CONVERSATION_PARAM = "langyConversation";

/**
 * Carry `?langyConversation` from the current address onto a redirect target.
 *
 * Only this one parameter travels: the landing redirect drops the rest on
 * purpose, and widening that here would carry auth and switcher parameters into
 * pages that never expected them.
 */
export function carryLangyConversation({
  destination,
  search,
}: {
  destination: string | null;
  search: string;
}): string | null {
  if (destination === null) return null;
  const conversationId = new URLSearchParams(search).get(
    LANGY_CONVERSATION_PARAM,
  );
  if (!conversationId) return destination;
  // A destination that already carries the parameter is left alone, so this is
  // safe to apply to a redirect that runs more than once.
  const [path, existing] = destination.split("?", 2);
  const params = new URLSearchParams(existing ?? "");
  if (params.has(LANGY_CONVERSATION_PARAM)) return destination;
  params.set(LANGY_CONVERSATION_PARAM, conversationId);
  return `${path}?${params.toString()}`;
}
