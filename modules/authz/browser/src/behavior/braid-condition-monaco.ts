import { getRawColorValue } from "@langwatch/design-system/color-mode";
import { EXPRESSION_TOKEN_COLOR } from "@langwatch/design-system/highlighted-expression";
import type { Monaco } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";

import {
  BRAID_CONDITION_LANGUAGE_ID,
  BRAID_CONDITION_MONARCH,
  BRAID_CONDITION_TOKEN_KINDS,
  type BraidConditionCompletion,
  braidConditionCompletions,
} from "../model/braids/braid-condition-language.ts";

type AttributeKeys = readonly { key: string; spanCount: number }[];

const MARKER_OWNER = "braid-condition";
/** Per model URI, so two open editors each complete against their own owner's keys. */
const keysByModelUri = new Map<string, AttributeKeys>();
const registered = new WeakSet<Monaco>();

const THEME_COLORS: readonly (readonly [string, string])[] = [
  ["editor.background", "bg.panel"],
  ["editor.foreground", "fg"],
  ["editorCursor.foreground", "fg"],
  ["editor.selectionBackground", "bg.emphasized"],
  ["editorError.foreground", "fg.error"],
  ["editorSuggestWidget.background", "bg.panel"],
  ["editorSuggestWidget.border", "border"],
  ["editorSuggestWidget.foreground", "fg"],
  ["editorSuggestWidget.selectedBackground", "bg.muted"],
  ["editorSuggestWidget.highlightForeground", "blue.fg"],
];

/** A token's colour as Monaco's theme wants it (hex, no `#`); undefined keeps Monaco's own. */
function hexOf(token: string): string | undefined {
  let value: string;
  try {
    value = getRawColorValue(token).trim();
  } catch {
    return undefined;
  }
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value.slice(1) : undefined;
}

function completionKind({
  monaco,
  kind,
}: {
  monaco: Monaco;
  kind: BraidConditionCompletion["kind"];
}): number {
  const kinds = monaco.languages.CompletionItemKind;
  if (kind === "field") return kinds.Field;
  if (kind === "operator") return kinds.Operator;
  if (kind === "snippet") return kinds.Snippet;
  return kinds.Keyword;
}

function completionProvider(monaco: Monaco): languages.CompletionItemProvider {
  return {
    triggerCharacters: ["[", '"'],
    provideCompletionItems: (model, position) => {
      const offset = model.getOffsetAt(position);
      const { items, replaceFrom, replaceTo } = braidConditionCompletions({
        text: model.getValue(),
        offset,
        attributeKeys: keysByModelUri.get(model.uri.toString()) ?? [],
      });
      const from = model.getPositionAt(replaceFrom);
      const to = model.getPositionAt(replaceTo);
      const insert = {
        startLineNumber: from.lineNumber,
        startColumn: from.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };
      const replace = { ...insert, endLineNumber: to.lineNumber, endColumn: to.column };
      return {
        suggestions: items.map((item) => ({
          label: item.label,
          kind: completionKind({ monaco, kind: item.kind }),
          insertText: item.insertText,
          insertTextRules: item.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          detail: item.detail,
          sortText: item.sortText,
          filterText: item.filterText,
          command: item.retrigger
            ? { id: "editor.action.triggerSuggest", title: "Suggest" }
            : undefined,
          range: { insert, replace },
        })),
      };
    },
  };
}

/** Registers the language, grammar and completion once per Monaco; call from `beforeMount`. */
export function registerBraidConditionLanguage(monaco: Monaco): void {
  if (registered.has(monaco)) return;
  registered.add(monaco);
  monaco.languages.register({ id: BRAID_CONDITION_LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration(BRAID_CONDITION_LANGUAGE_ID, {
    brackets: [
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
    ],
  });
  monaco.languages.setMonarchTokensProvider(BRAID_CONDITION_LANGUAGE_ID, BRAID_CONDITION_MONARCH);
  monaco.languages.registerCompletionItemProvider(
    BRAID_CONDITION_LANGUAGE_ID,
    completionProvider(monaco),
  );
}

/** The theme for the current colour mode, its colours read from the design system's tokens. */
export function defineBraidConditionTheme({
  monaco,
  name,
  dark,
}: {
  monaco: Monaco;
  name: string;
  dark: boolean;
}): void {
  const rules = BRAID_CONDITION_TOKEN_KINDS.flatMap((kind) => {
    const foreground = hexOf(EXPRESSION_TOKEN_COLOR[kind]);
    return foreground ? [{ token: kind, foreground }] : [];
  });
  const colors = Object.fromEntries(
    THEME_COLORS.flatMap(([key, token]) => {
      const hex = hexOf(token);
      return hex ? [[key, `#${hex}`]] : [];
    }),
  );
  monaco.editor.defineTheme(name, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules,
    colors,
  });
}

/** Hands a model the owner's attribute keys its completion offers. */
export function setBraidConditionKeys({
  model,
  attributeKeys,
}: {
  model: editor.ITextModel;
  attributeKeys: AttributeKeys;
}): void {
  keysByModelUri.set(model.uri.toString(), attributeKeys);
}

export function clearBraidConditionKeys(model: editor.ITextModel): void {
  keysByModelUri.delete(model.uri.toString());
}

/** Draws the refusal at its offsets with its fix; undefined clears it. */
export function applyBraidConditionRefusal({
  monaco,
  model,
  refusal,
}: {
  monaco: Monaco;
  model: editor.ITextModel;
  refusal: { at: number; end: number; message: string } | undefined;
}): void {
  if (!refusal) {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    return;
  }
  const from = model.getPositionAt(refusal.at);
  const to = model.getPositionAt(refusal.end);
  monaco.editor.setModelMarkers(model, MARKER_OWNER, [
    {
      severity: monaco.MarkerSeverity.Error,
      message: refusal.message,
      startLineNumber: from.lineNumber,
      startColumn: from.column,
      endLineNumber: to.lineNumber,
      endColumn: to.column,
    },
  ]);
}
