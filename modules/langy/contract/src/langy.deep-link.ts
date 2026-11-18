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
  destination: string;
  search: string;
}): string {
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

/** `?langy=open` opens the panel. Spec: specs/langy/langy-prompt-link.feature */
export const LANGY_OPEN_PARAM = "langy";
/** `?langyPrompt=<text>` types `<text>` into a fresh conversation's composer, never sent. */
export const LANGY_PROMPT_PARAM = "langyPrompt";

export type LangyPromptLink = Readonly<{ prompt: string }>;

/** What a `?langy=open&langyPrompt=...` address asks for: an empty array when it asks nothing. */
export function findLangyPromptLink({ search }: { search: string }): LangyPromptLink[] {
  const params = new URLSearchParams(search);
  const prompt = params.get(LANGY_PROMPT_PARAM);
  if (params.get(LANGY_OPEN_PARAM) !== "open" && prompt === null) return [];
  return [{ prompt: prompt ?? "" }];
}

/**
 * The address with the link's parameters removed, everything else kept. A `langyConversation`
 * beside them goes too: the question opens a new conversation, so that link is superseded.
 */
export function withoutLangyPromptLink({ search }: { search: string }): string {
  const params = new URLSearchParams(search);
  params.delete(LANGY_OPEN_PARAM);
  params.delete(LANGY_PROMPT_PARAM);
  params.delete(LANGY_CONVERSATION_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** A project page address that opens Langy with `prompt` typed in. */
export function buildLangyPromptLink({ path, prompt }: { path: string; prompt: string }): string {
  const hashAt = path.indexOf("#");
  const beforeHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const pathname = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : beforeHash.slice(queryAt));
  params.set(LANGY_OPEN_PARAM, "open");
  params.set(LANGY_PROMPT_PARAM, prompt);
  return `${pathname}?${params.toString()}${hash}`;
}
