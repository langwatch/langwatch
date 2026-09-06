import {
  LANGY_LOCAL_CONNECT_NOTICE,
  type PermissionRequiredFrame,
} from "@langwatch/langy-contract";

/**
 * Every pattern one "allow for this session" answer grants.
 *
 * The command line grants a pattern for every part of the chain that is not
 * read-only, so a card that named only `frame.pattern` told the reader about
 * the first of them and gave away the rest. The segments the ask carries are
 * the whole list; a command line that sends none leaves the one pattern.
 */
export function grantedPatterns(frame: PermissionRequiredFrame): string[] {
  const fromSegments = (frame.segments ?? [])
    .filter((segment) => !segment.readOnly)
    .map((segment) => segment.pattern)
    .filter((pattern) => pattern !== "");
  const patterns = fromSegments.length > 0 ? fromSegments : [frame.pattern];
  return [...new Set(patterns)].filter((pattern) => pattern !== "");
}

/**
 * The message the connected folder starts the next turn with.
 *
 * Four words, and no facts. The model reads the path, the machine and the
 * branch off the workspace facts the code access tool hands it, so nothing is
 * lost, and the panel draws no bubble for it at all: the header chip and the
 * code access card above it already say the folder is connected.
 */
export function connectMessage(): string {
  return LANGY_LOCAL_CONNECT_NOTICE;
}

/**
 * The line the transcript carries when the folder goes away.
 *
 * The folder NAME, for the same reason the connect line above uses it: the
 * path is long, the card already carries it, and the two lines sit next to
 * each other in the transcript.
 */
export function disconnectMessage(
  workspace: { name: string; root: string },
  hostname: string,
): string {
  return `Local folder disconnected: ${workspace.name || workspace.root} on ${hostname}`;
}

/**
 * How long a conversation name may be where the terminal prints it on one
 * line, next to the folder path and the project name.
 */
const MAX_TITLE_LENGTH = 60;

/** The name of a conversation Langy has not named yet. */
const UNNAMED_CONVERSATION_TITLE = "Langy";

/**
 * The conversation name the card and the terminal show.
 *
 * Langy names a conversation after the first turn, and that name is short. A
 * conversation that has no name yet carries a placeholder cut from the first
 * message, which runs to the width of the terminal and often stops mid word.
 * So a name over the limit is cut back to the last whole word and closed with
 * an ellipsis.
 */
export function conversationTitle(title: string | null | undefined): string {
  const trimmed = (title ?? "").trim();

  if (trimmed === "") {
    return UNNAMED_CONVERSATION_TITLE;
  }

  if (trimmed.length <= MAX_TITLE_LENGTH) {
    return trimmed;
  }

  const cut = trimmed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const words = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${words.replace(/[\s.,;:!?-]+$/, "")}…`;
}

/**
 * Where the panel opens one conversation, as a link the terminal can open.
 *
 * `BASE_HOST` is the external-facing origin, the same one the emails and the
 * API's `platformUrl` build their links from. A relative path is correct in
 * the browser and useless in a terminal, so the absolute form is what this
 * returns. An origin that is empty or has no scheme cannot be trusted to
 * build a link, so the path travels on its own rather than as a guess.
 *
 * The link names the PROJECT the conversation belongs to. A conversation is
 * project scoped, and the panel reads it through a project scoped query, so a
 * link to the reader's own home opens the panel on the wrong project whenever
 * the reader last worked somewhere else, and the conversation then reads as
 * one they cannot see. Root stays the answer when the project is not known,
 * and the landing redirect carries the parameter onto whatever home it picks.
 */
export function conversationUrl(
  conversationId: string,
  baseHost: string | undefined,
  projectSlug?: string,
): string {
  const home = projectSlug ? `/${encodeURIComponent(projectSlug)}` : "/";
  const path = `${home}?langyConversation=${encodeURIComponent(conversationId)}`;
  const origin = (baseHost ?? "").trim().replace(/\/+$/, "");

  if (!/^https?:\/\//i.test(origin)) {
    return path;
  }

  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}
