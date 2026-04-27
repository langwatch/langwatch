/**
 * Pure function deciding what action a keystroke should produce given the
 * current editor + dropdown state. See PRD-003a for the full keyboard
 * contract.
 *
 * Keeping this logic out of the TipTap component lets us cover every row
 * of the contract with cheap unit tests; the React/ProseMirror layer just
 * dispatches whatever action this returns.
 */

import type { SuggestionState } from "./getSuggestionState";

export type EditorContext = {
  text: string;
  cursorPos: number;
  suggestion: SuggestionState;
  /** The currently highlighted suggestion's display text, or null if none. */
  highlightedText: string | null;
};

export type KeyAction =
  | { kind: "noop" }
  | { kind: "submit"; text: string }
  | { kind: "blur" }
  | { kind: "close-dropdown" }
  | { kind: "navigate"; direction: "up" | "down" }
  | {
      kind: "accept";
      tokenStart: number;
      tokenEnd: number;
      replacement: string;
      reopenInValueMode: boolean;
    };

function acceptAction(
  ctx: EditorContext,
  highlighted: string,
): KeyAction | null {
  if (!ctx.suggestion.open) return null;

  const tokenEnd = ctx.cursorPos;
  const queryLen = ctx.suggestion.query.length;

  if (ctx.suggestion.mode === "field") {
    // Token spans from `@` to cursor: `@` + query
    const tokenStart = tokenEnd - queryLen - 1;
    return {
      kind: "accept",
      tokenStart,
      tokenEnd,
      replacement: `@${highlighted}:`,
      reopenInValueMode: true,
    };
  }

  // Value mode: token spans from `@` to cursor: `@field:` + query
  const tokenStart =
    tokenEnd - queryLen - 1 - ctx.suggestion.field.length - 1;
  return {
    kind: "accept",
    tokenStart,
    tokenEnd,
    replacement: `@${ctx.suggestion.field}:${highlighted} `,
    reopenInValueMode: false,
  };
}

export function handleKey(ctx: EditorContext, key: string): KeyAction {
  if (key === "Enter" || key === "Tab") {
    if (ctx.suggestion.open && ctx.highlightedText) {
      const accept = acceptAction(ctx, ctx.highlightedText);
      if (accept) return accept;
    }
    if (key === "Tab") {
      // No suggestion to accept — let the browser handle Tab (focus moves out, blur submits).
      return { kind: "noop" };
    }
    return { kind: "submit", text: ctx.text };
  }

  if (key === "Escape") {
    return ctx.suggestion.open ? { kind: "close-dropdown" } : { kind: "blur" };
  }

  if (key === "ArrowDown" || key === "ArrowUp") {
    if (!ctx.suggestion.open) return { kind: "noop" };
    return {
      kind: "navigate",
      direction: key === "ArrowDown" ? "down" : "up",
    };
  }

  return { kind: "noop" };
}
