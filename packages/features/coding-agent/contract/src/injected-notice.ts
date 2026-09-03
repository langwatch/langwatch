import { splitLeadingContextBlocks } from "./leading-context";

/** Blocks an agent injects into a user message that the human never typed. */
const SYSTEM_NOTIFICATION_MARKER = "[SYSTEM NOTIFICATION";
const SUMMARY_MAX_CHARS = 120;
const BLOCK_OPEN_TAG = /^\s*<([a-zA-Z][\w-]*)(?:\s[^>]*)?>/;
const SUMMARY_TAG = /<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/i;

export interface InjectedNotice {
  label: string;
  body: string;
}

export interface ClassifiedPrompt {
  notices: InjectedNotice[];
  remainder: string | null;
}

/** Split injected leading notices from the human's prompt text. */
export function classifyPromptText(text: string): ClassifiedPrompt {
  if (text.trimStart().startsWith(SYSTEM_NOTIFICATION_MARKER)) {
    return {
      notices: [{ label: summaryOf(text) ?? "system notification", body: text }],
      remainder: null,
    };
  }

  const { blocks, body } = splitLeadingContextBlocks(text);
  if (blocks.length === 0) {
    return { notices: [], remainder: text };
  }

  return {
    notices: blocks.map((block) => {
      const trimmed = block.trim();
      return { label: labelOf(trimmed), body: trimmed };
    }),
    remainder: body.trim() === "" ? null : body,
  };
}

function labelOf(block: string): string {
  const tagName = BLOCK_OPEN_TAG.exec(block)?.[1] ?? "note";
  const humanized = tagName.replace(/[-_]+/g, " ").trim();
  const summary = summaryOf(block);
  return summary === null ? humanized : `${humanized}: ${summary}`;
}

function summaryOf(text: string): string | null {
  const inner = SUMMARY_TAG.exec(text)?.[1];
  if (inner === void 0) {
    return null;
  }
  const collapsed = inner.replace(/\s+/g, " ").trim();
  if (collapsed === "") {
    return null;
  }
  return collapsed.length > SUMMARY_MAX_CHARS
    ? `${collapsed.slice(0, SUMMARY_MAX_CHARS - 1)}…`
    : collapsed;
}
