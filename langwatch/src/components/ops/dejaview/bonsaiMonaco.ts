import type { Monaco } from "@monaco-editor/react";
import { bonsai } from "bonsai-js";
import { arrays, math, strings, types } from "bonsai-js/stdlib";
import type { editor, languages, Position } from "monaco-editor";

/**
 * Client-side Monaco support for the normalisation-preview expression
 * rules: a lightweight "bonsai" language (tokens for strings, numbers,
 * pipes), autocomplete for `attr("…")`/`has`/`take` over the selected
 * event's attribute keys plus the stdlib transforms, and live parse
 * validation via the same bonsai parser the server uses — so an
 * expression that shows no marker here will compile server-side too.
 */

export const BONSAI_LANGUAGE_ID = "bonsai";
const MARKER_OWNER = "bonsai-preview";

/** Mirrors the server evaluator in normalisation-preview.rules.ts. */
const validator = bonsai({ timeout: 50, maxDepth: 30 })
  .use(strings)
  .use(arrays)
  .use(math)
  .use(types);
// Parse-time stubs for the server's bag functions so references to them
// validate cleanly in the editor.
validator.addFunction("attr", () => undefined);
validator.addFunction("has", () => false);
validator.addFunction("take", () => undefined);

/** Stdlib transforms + bag helpers surfaced in autocomplete. */
const TRANSFORM_SUGGESTIONS: Array<{ label: string; detail: string }> = [
  { label: "upper", detail: "uppercase a string" },
  { label: "lower", detail: "lowercase a string" },
  { label: "trim", detail: "trim whitespace" },
  { label: "split", detail: "split(sep) a string into an array" },
  { label: "count", detail: "length of an array or string" },
  { label: "sort", detail: "sort an array" },
  { label: "round", detail: "round a number" },
  { label: "filter", detail: "filter(.field == value) an array" },
  { label: "map", detail: "map(.field) over an array" },
  { label: "find", detail: "find(.field == value) in an array" },
  { label: "some", detail: "some(.predicate) over an array" },
  { label: "every", detail: "every(.predicate) over an array" },
];

/**
 * Attribute keys offered inside attr()/has()/take() completions. Mutable
 * module state because Monaco completion providers are registered once
 * per language, while the key set follows the selected event.
 */
let currentAttributeKeys: string[] = [];
export function setBonsaiCompletionKeys(keys: string[]): void {
  currentAttributeKeys = keys;
}

let registeredOn: Monaco | null = null;

export function registerBonsaiLanguage(monaco: Monaco): void {
  if (registeredOn === monaco) return;
  registeredOn = monaco;

  if (
    !monaco.languages
      .getLanguages()
      .some((l: { id: string }) => l.id === BONSAI_LANGUAGE_ID)
  ) {
    monaco.languages.register({ id: BONSAI_LANGUAGE_ID });
  }

  monaco.languages.setMonarchTokensProvider(BONSAI_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/'(?:[^'\\]|\\.)*'/, "string"],
        [/\|>/, "keyword"],
        [/\?\?/, "keyword"],
        [/\b(?:true|false|null)\b/, "keyword"],
        [/\b(?:attr|has|take)\b/, "type"],
        [/\d+(?:\.\d+)?/, "number"],
        [/[a-zA-Z_][\w$]*/, "identifier"],
        [/[()[\]{}.,]/, "delimiter"],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider(BONSAI_LANGUAGE_ID, {
    triggerCharacters: ['"', "'", "(", ">", "."],
    provideCompletionItems: (model: editor.ITextModel, position: Position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const line = model.getLineContent(position.lineNumber);
      const beforeCursor = line.slice(0, position.column - 1);

      // Inside attr("…") / has("…") / take("…") → suggest attribute keys.
      if (/(?:attr|has|take)\(\s*["']?[^"')]*$/.test(beforeCursor)) {
        return {
          suggestions: currentAttributeKeys.map(
            (key): languages.CompletionItem => ({
              label: key,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: key,
              range,
              detail: "attribute on this event",
            }),
          ),
        };
      }

      const snippet = (
        label: string,
        insertText: string,
        detail: string,
      ): languages.CompletionItem => ({
        label,
        kind: monaco.languages.CompletionItemKind.Method,
        insertText,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        detail,
      });

      const suggestions: languages.CompletionItem[] = [
        snippet("attr", 'attr("$1")', "read an attribute by (dotted) key"),
        snippet("has", 'has("$1")', "true when the attribute exists"),
        snippet(
          "take",
          'take("$1")',
          "read AND consume an attribute (like an extractor)",
        ),
        {
          label: "attrs",
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: "attrs",
          range,
          detail: "the whole attribute map",
        },
        ...TRANSFORM_SUGGESTIONS.map(
          (t): languages.CompletionItem => ({
            label: t.label,
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: t.label,
            range,
            detail: t.detail,
          }),
        ),
      ];
      return { suggestions };
    },
  });
}

/**
 * Parse-validates a model's expression and paints squiggles at the
 * reported positions. Returns true when the expression is valid.
 */
export function validateBonsaiModel(
  monaco: Monaco,
  model: editor.ITextModel,
): boolean {
  const text = model.getValue();
  if (text.trim().length === 0) {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    return false;
  }

  const result = validator.validate(text);
  monaco.editor.setModelMarkers(
    model,
    MARKER_OWNER,
    result.valid
      ? []
      : result.errors.map((err) => ({
          severity: monaco.MarkerSeverity.Error,
          message: err.message,
          startLineNumber: err.position?.line ?? 1,
          startColumn: err.position?.column ?? 1,
          endLineNumber: err.position?.line ?? 1,
          endColumn: (err.position?.column ?? 1) + 1,
        })),
  );
  return result.valid;
}

/** Quick validity probe for non-editor callers (run-button gating). */
export function isValidBonsaiExpression(text: string): boolean {
  if (text.trim().length === 0) return false;
  return validator.validate(text).valid;
}
