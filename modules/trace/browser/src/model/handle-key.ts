import type { SuggestionState } from "@langwatch/trace-browser-kit";
import { isInstantEvalField } from "@langwatch/trace-contract";

import {
  isInsideQuotedValue,
  searchBarSuggestionState,
  TRACE_SEARCH_GRAMMAR,
} from "./search-bar-suggestion-state.ts";

const FIELD_VALUE_SEPARATOR = ":";

/**
 * Whether this field's value is a sentence rather than one term. The filter
 * language ends a term at a space; an `eval` value is the question a judge
 * reads, so its spaces belong to the value and it is written quoted.
 */
function takesSentence(fieldName: string): boolean {
  return isInstantEvalField(fieldName);
}

export type EditorContext = {
  text: string;
  cursorPos: number;
  suggestion: SuggestionState;
  highlightedText: string | null;
  /** True when the highlighted item is a namespaced prefix
   * (`trace.attribute.`) — accept inserts the prefix without a trailing
   * `:` and stays in field-mode so the user can complete the key. */
  highlightedIsPrefix?: boolean;
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
      /**
       * Where to leave the caret, counted back from the end of the
       * replacement. Parks it inside the quotes of a value still to write.
       */
      caretBack?: number;
    };

function acceptAction(ctx: EditorContext, highlighted: string): KeyAction | null {
  if (!ctx.suggestion.open) {
    return null;
  }

  const { tokenStart } = ctx.suggestion;
  const tokenEnd = ctx.cursorPos;

  if (ctx.suggestion.mode === "field") {
    // Namespaced prefix — drop the user back where they were, just with
    // `trace.attribute.` (or similar) inserted. The key still has to be
    // typed; we don't auto-append `:` because the field name isn't
    // complete yet.
    if (ctx.highlightedIsPrefix) {
      return {
        kind: "accept",
        tokenStart,
        tokenEnd,
        replacement: highlighted,
        reopenInValueMode: false,
      };
    }
    // A field whose value is a sentence opens its quotes here, with the caret
    // between them: the question is typed inside the chip, spaces and all,
    // rather than ending it at the first space.
    if (takesSentence(highlighted)) {
      return {
        kind: "accept",
        tokenStart,
        tokenEnd,
        replacement: `${highlighted}${FIELD_VALUE_SEPARATOR}""`,
        reopenInValueMode: false,
        caretBack: 1,
      };
    }
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
    // Trailing space lets the user start the next clause without manually separating,
    // and visually pushes the cursor past the per-token X widget.
    replacement: `${ctx.suggestion.field}${FIELD_VALUE_SEPARATOR}${highlighted}\u00A0`,
    reopenInValueMode: false,
  };
}

function handleEnterOrTab(ctx: EditorContext, key: "Enter" | "Tab"): KeyAction {
  if (ctx.suggestion.open && ctx.highlightedText) {
    const accept = acceptAction(ctx, ctx.highlightedText);
    if (accept) {
      return accept;
    }
  }
  if (key === "Tab") {
    return { kind: "noop" };
  }
  return { kind: "submit", text: ctx.text };
}

/** Where the token under the caret ends: the next terminator, or the end. */
function activeTokenEnd(text: string, cursorPos: number): number {
  let end = cursorPos;
  while (end < text.length && !TRACE_SEARCH_GRAMMAR.tokenTerminators.has(text[end] as string)) {
    end += 1;
  }
  return end;
}

/**
 * A space typed into an unquoted sentence value quotes it rather than ending
 * the term: without this a question cannot be typed by hand at all. Read from
 * the text, so a dropdown closed with Escape does not change what a space does.
 */
function quoteSentenceValueAction(ctx: EditorContext): KeyAction | null {
  const live = searchBarSuggestionState(ctx.text, ctx.cursorPos);
  if (!live.open || live.mode !== "value") return null;
  if (!takesSentence(live.field)) return null;
  // The token runs past the caret when the space is typed mid-word; that tail
  // stays inside the quotes, after the space, where the reader put it.
  const tokenEnd = activeTokenEnd(ctx.text, ctx.cursorPos);
  const tail = ctx.text.slice(ctx.cursorPos, tokenEnd);
  if (tail.includes('"')) return null;
  const value = live.query;
  return {
    kind: "accept",
    tokenStart: live.tokenStart,
    tokenEnd,
    // An empty value swallows the space: the question starts at its first
    // word, and a leading space in a chip is dropped when it is read anyway.
    replacement: `${live.field}${FIELD_VALUE_SEPARATOR}"${value}${value ? " " : ""}${tail}"`,
    reopenInValueMode: false,
    caretBack: 1 + tail.length,
  };
}

/**
 * A quote typed against the closing quote of the value steps over it, the way
 * Arrow Right would, rather than opening a second pair. The quotes were put
 * there for the reader, so closing them by hand is the natural way out.
 */
function stepOverClosingQuoteAction(ctx: EditorContext): KeyAction | null {
  if (ctx.text[ctx.cursorPos] !== '"') return null;
  if (!isInsideQuotedValue(ctx.text, ctx.cursorPos)) return null;
  return {
    kind: "accept",
    tokenStart: ctx.cursorPos,
    tokenEnd: ctx.cursorPos + 1,
    replacement: '"',
    reopenInValueMode: false,
    caretBack: 0,
  };
}

export function handleKey(ctx: EditorContext, key: string): KeyAction {
  if (key === " ") {
    return quoteSentenceValueAction(ctx) ?? { kind: "noop" };
  }

  if (key === '"') {
    return stepOverClosingQuoteAction(ctx) ?? { kind: "noop" };
  }

  if (key === "Enter" || key === "Tab") {
    return handleEnterOrTab(ctx, key);
  }

  if (key === "Escape") {
    return ctx.suggestion.open ? { kind: "close-dropdown" } : { kind: "blur" };
  }

  if (key === "ArrowDown" || key === "ArrowUp") {
    if (!ctx.suggestion.open) {
      return { kind: "noop" };
    }
    return {
      kind: "navigate",
      direction: key === "ArrowDown" ? "down" : "up",
    };
  }

  return { kind: "noop" };
}
