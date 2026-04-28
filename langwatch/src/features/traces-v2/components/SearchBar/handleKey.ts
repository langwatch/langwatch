import type { SuggestionState } from "./getSuggestionState";

const FIELD_VALUE_SEPARATOR = ":";

export type EditorContext = {
  text: string;
  cursorPos: number;
  suggestion: SuggestionState;
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

  const { tokenStart } = ctx.suggestion;
  const tokenEnd = ctx.cursorPos;

  if (ctx.suggestion.mode === "field") {
    return {
      kind: "accept",
      tokenStart,
      tokenEnd,
      replacement: `${highlighted}${FIELD_VALUE_SEPARATOR}`,
      reopenInValueMode: true,
    };
  }

  return {
    kind: "accept",
    tokenStart,
    tokenEnd,
    replacement: `${ctx.suggestion.field}${FIELD_VALUE_SEPARATOR}${highlighted} `,
    reopenInValueMode: false,
  };
}

export function handleKey(ctx: EditorContext, key: string): KeyAction {
  if (key === "Enter" || key === "Tab") {
    if (ctx.suggestion.open && ctx.highlightedText) {
      const accept = acceptAction(ctx, ctx.highlightedText);
      if (accept) return accept;
    }
    // No suggestion to accept on Tab — let the browser handle it (focus moves out, blur submits).
    if (key === "Tab") return { kind: "noop" };
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
