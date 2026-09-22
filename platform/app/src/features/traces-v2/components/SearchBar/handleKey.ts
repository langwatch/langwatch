import { isInstantEvalField } from "~/server/app-layer/traces/query-language/instantEvalChips";
import {
  getSuggestionState,
  SEARCH_GRAMMAR,
  type SuggestionState,
} from "./getSuggestionState";

const FIELD_VALUE_SEPARATOR = ":";

/**
 * Whether this field's value is a sentence rather than one term.
 *
 * The filter language ends a term at a space, which is what separates
 * `status:error` from the clause after it. An `eval` value is the question a
 * judge reads, so its spaces belong to the value and it is written quoted.
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
       * replacement. Used to park it inside the quotes of a value the user
       * still has to write.
       */
      caretBack?: number;
    };

function acceptAction(
  ctx: EditorContext,
  highlighted: string,
): KeyAction | null {
  if (!ctx.suggestion.open) return null;

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
    // A field whose value is a sentence opens its quotes here, with the
    // caret between them: the question is typed inside the chip, spaces and
    // all, rather than ending it at the first space.
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
    // Trailing space lets the user start the next clause without manually
    // separating, and visually pushes the cursor past the per-token X widget.
    //
    // We insert U+00A0 (NBSP) instead of a regular space because
    // contenteditable normalisation eats trailing regular spaces at the
    // end of a text node when the user types the next character —
    // `origin:evaluation ` + `A` becomes `origin:evaluationA` (no space).
    // NBSP survives that round-trip. The parser converts NBSP → space in
    // `stripAtSigils`, so the user sees a space, ProseMirror keeps the
    // char, and liqe splits the clauses correctly.
    replacement: `${ctx.suggestion.field}${FIELD_VALUE_SEPARATOR}${highlighted}\u00A0`,
    reopenInValueMode: false,
  };
}

/**
 * A space typed into an unquoted sentence value quotes it, rather than ending
 * the term. Without this a question cannot be typed by hand at all: the first
 * space leaves the chip and the rest of the words become a separate search.
 *
 * Read from the text rather than from `ctx.suggestion`, so a dropdown the
 * reader closed with Escape does not change what a space does.
 */
function quoteSentenceValueAction(ctx: EditorContext): KeyAction | null {
  const live = getSuggestionState(ctx.text, ctx.cursorPos);
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

/** Where the token under the caret ends: the next terminator, or the text's end. */
function activeTokenEnd(text: string, cursorPos: number): number {
  let end = cursorPos;
  while (
    end < text.length &&
    !SEARCH_GRAMMAR.tokenTerminators.has(text[end] as string)
  ) {
    end += 1;
  }
  return end;
}

export function handleKey(ctx: EditorContext, key: string): KeyAction {
  if (key === " ") {
    return quoteSentenceValueAction(ctx) ?? { kind: "noop" };
  }

  if (key === "Enter" || key === "Tab") {
    if (ctx.suggestion.open && ctx.highlightedText) {
      const accept = acceptAction(ctx, ctx.highlightedText);
      if (accept) return accept;
    }
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
