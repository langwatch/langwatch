import { splitLeadingContextBlocks } from "../../../utils/leadingContext";

/**
 * Blocks an agent injects INTO a user message that the human never typed: a
 * monitor firing, a hook's system reminder, a queued task notification. They
 * arrive as the user's turn because that is the only channel an agent has to
 * hand something to the model mid-session.
 *
 * Printed verbatim behind the prompt caret they read as the reader's own
 * words, which is wrong twice over: the reader gets credited with a wall of
 * XML they never wrote, and the message they DID write is buried under it.
 * The terminal draws them as notes about the session instead, one collapsed
 * line each, with the human's words left as the prompt.
 */

/**
 * Claude Code's mid-session notification, which arrives as prose rather than
 * a tag block: everything after the marker belongs to the notification, so
 * there is no human remainder to keep.
 */
const SYSTEM_NOTIFICATION_MARKER = "[SYSTEM NOTIFICATION";

/** A collapsed line is one line: a longer summary is cut, not wrapped. */
const SUMMARY_MAX_CHARS = 120;

/** Matches a block's own opening tag, capturing the tag name. */
const BLOCK_OPEN_TAG = /^\s*<([a-zA-Z][\w-]*)(?:\s[^>]*)?>/;

/** The `<summary>` a well-formed injected block names itself with. */
const SUMMARY_TAG = /<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/i;

export interface InjectedNotice {
  /** The single collapsed line: what was injected, and what it was about. */
  label: string;
  /** The block exactly as it arrived, shown when the reader expands it. */
  body: string;
}

export interface ClassifiedPrompt {
  notices: InjectedNotice[];
  /** The human's own words, or null when the message was injection only. */
  remainder: string | null;
}

/**
 * Split a user message into what was injected into it and what the human
 * actually typed. A message with neither marker nor leading tag block is
 * returned untouched as the prompt.
 */
export function classifyPromptText(text: string): ClassifiedPrompt {
  if (text.trimStart().startsWith(SYSTEM_NOTIFICATION_MARKER)) {
    return {
      notices: [
        { label: summaryOf(text) ?? "system notification", body: text },
      ],
      remainder: null,
    };
  }

  const { context, body } = splitLeadingContextBlocks(text);
  if (context === "") return { notices: [], remainder: text };

  const blocks = splitTopLevelBlocks(context);
  if (blocks.length === 0) return { notices: [], remainder: text };

  return {
    notices: blocks.map((block) => ({ label: labelOf(block), body: block })),
    remainder: body.trim() === "" ? null : body,
  };
}

/**
 * The peeled context comes back as one joined string, and the terminal draws
 * one collapsed line per injected block: a monitor event and a system reminder
 * arriving together are two different things happening to the session, not one.
 */
function splitTopLevelBlocks(context: string): string[] {
  const blocks: string[] = [];
  let rest = context;

  while (rest.trim() !== "") {
    const open = BLOCK_OPEN_TAG.exec(rest);
    if (!open) break;
    const closeTag = `</${open[1]!}>`;
    const closeIndex = rest.indexOf(closeTag, open[0].length);
    if (closeIndex === -1) break;
    const end = closeIndex + closeTag.length;
    blocks.push(rest.slice(0, end).trim());
    rest = rest.slice(end);
  }

  return blocks;
}

/** `task notification: Monitor event "PR watch"`: the tag, then what it was about. */
function labelOf(block: string): string {
  const tagName = BLOCK_OPEN_TAG.exec(block)?.[1] ?? "note";
  const humanized = tagName.replace(/[-_]+/g, " ").trim();
  const summary = summaryOf(block);
  return summary === null ? humanized : `${humanized}: ${summary}`;
}

function summaryOf(text: string): string | null {
  const inner = SUMMARY_TAG.exec(text)?.[1];
  if (inner === undefined) return null;
  const collapsed = inner.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  return collapsed.length > SUMMARY_MAX_CHARS
    ? `${collapsed.slice(0, SUMMARY_MAX_CHARS - 1)}…`
    : collapsed;
}
