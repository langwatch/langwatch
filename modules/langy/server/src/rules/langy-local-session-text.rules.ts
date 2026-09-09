import {
  LANGY_LOCAL_CONNECT_NOTICE,
  type PermissionRequiredFrame,
} from "@langwatch/langy-contract";

/**
 * Every pattern one "allow for this session" answer grants: every non-read-only
 * segment, or the one `frame.pattern` when no segments are sent.
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
 * The message the connected folder starts the next turn with. No facts here —
 * the model reads path/machine/branch off the code-access tool instead.
 */
export function connectMessage(): string {
  return LANGY_LOCAL_CONNECT_NOTICE;
}

/** The line the transcript carries when the folder goes away — folder NAME, not path (already on the card). */
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
 * The conversation name the card and the terminal show. Over the limit, cut
 * back to the last whole word and closed with an ellipsis.
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
 * Absolute (relative is useless in a terminal); scoped to the conversation's
 * own project, not the reader's last-worked one.
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
