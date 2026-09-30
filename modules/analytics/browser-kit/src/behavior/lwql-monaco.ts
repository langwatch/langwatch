import type { LangWatchQLSchema } from "@langwatch/analytics-contract";
import type { Monaco } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";

import { type LwqlParameter, lwqlCompletions } from "../model/lwql-language/lwql-completion.ts";
import { lwqlHoverAt } from "../model/lwql-language/lwql-hover.ts";
import type { LwqlEditorMarker } from "../model/lwql-language/lwql-marker.ts";
import {
  EMPTY_LWQL_VOCABULARY,
  LWQL_LANGUAGE_CONFIGURATION,
  LWQL_LANGUAGE_ID,
  lwqlMonarch,
  lwqlVocabularyOf,
} from "../model/lwql-language/lwql-monarch.ts";

type ModelState = { schema: LangWatchQLSchema | undefined; parameters: readonly LwqlParameter[] };

const MARKER_OWNER = "lwql-diagnostics";
const PARAM_TOKEN = /\{([A-Za-z_]\w*):[A-Za-z0-9_]+\}/g;
const PARAM_STYLES_ID = "lw-sql-param-token-styles";

/** Per model URI, so editors on different projects each complete against their own schema. */
const stateByModelUri = new Map<string, ModelState>();
let providersRegistered = false;
let vocabularyKey = "";

function stateOf(model: editor.ITextModel): ModelState | undefined {
  return stateByModelUri.get(model.uri.toString());
}

function rangeOf({ model, start, end }: { model: editor.ITextModel; start: number; end: number }) {
  const from = model.getPositionAt(start);
  const to = model.getPositionAt(end);
  return {
    startLineNumber: from.lineNumber,
    startColumn: from.column,
    endLineNumber: to.lineNumber,
    endColumn: to.column,
  };
}

function completionKind({ monaco, kind }: { monaco: Monaco; kind: string }): number {
  const k = monaco.languages.CompletionItemKind;
  if (kind === "table") return k.Class;
  if (kind === "column") return k.Field;
  if (kind === "function") return k.Function;
  if (kind === "parameter") return k.Variable;
  if (kind === "snippet") return k.Snippet;
  return k.Keyword;
}

function completionProvider(monaco: Monaco): languages.CompletionItemProvider {
  return {
    triggerCharacters: [".", "{", " "],
    provideCompletionItems: (model, position) => {
      const state = stateOf(model);
      const { items, replaceFrom } = lwqlCompletions({
        schema: state?.schema,
        text: model.getValue(),
        offset: model.getOffsetAt(position),
        parameters: state?.parameters,
      });
      const range = rangeOf({
        model,
        start: replaceFrom,
        end: model.getOffsetAt(position),
      });
      return {
        suggestions: items.map((item) => ({
          label: item.label,
          kind: completionKind({ monaco, kind: item.kind }),
          insertText: item.insertText,
          insertTextRules: item.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          detail: item.detail,
          documentation: item.documentation ? { value: item.documentation } : undefined,
          sortText: item.sortText,
          filterText: item.label,
          tags: item.disabled ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
          range,
        })),
      };
    },
  };
}

function hoverProvider(): languages.HoverProvider {
  return {
    provideHover: (model, position) => {
      const hover = lwqlHoverAt({
        schema: stateOf(model)?.schema,
        text: model.getValue(),
        offset: model.getOffsetAt(position),
      });
      if (!hover) return null;
      return {
        contents: hover.contents.map((value) => ({ value })),
        range: rangeOf({ model, start: hover.start, end: hover.end }),
      };
    },
  };
}

/** Registers the language, grammar and providers once; call from Monaco's `beforeMount`. */
export function registerLwqlLanguage(monaco: Monaco): void {
  if (providersRegistered) return;
  providersRegistered = true;
  monaco.languages.register({ id: LWQL_LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration(LWQL_LANGUAGE_ID, LWQL_LANGUAGE_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(LWQL_LANGUAGE_ID, lwqlMonarch(EMPTY_LWQL_VOCABULARY));
  monaco.languages.registerCompletionItemProvider(LWQL_LANGUAGE_ID, completionProvider(monaco));
  monaco.languages.registerHoverProvider(LWQL_LANGUAGE_ID, hoverProvider());
}

/**
 * Hands a model the schema and parameters its completion reads, and re-tokenizes when the
 * schema's identifiers change. ponytail: the grammar is global, so the last schema wins.
 */
export function setLwqlModelState({
  monaco,
  model,
  schema,
  parameters,
}: {
  monaco: Monaco;
  model: editor.ITextModel;
  schema: LangWatchQLSchema | undefined;
  parameters: readonly LwqlParameter[];
}): void {
  stateByModelUri.set(model.uri.toString(), { schema, parameters });
  const vocabulary = lwqlVocabularyOf(schema);
  const key = JSON.stringify(vocabulary);
  if (key === vocabularyKey) return;
  vocabularyKey = key;
  monaco.languages.setMonarchTokensProvider(LWQL_LANGUAGE_ID, lwqlMonarch(vocabulary));
}

export function clearLwqlModelState(model: editor.ITextModel): void {
  stateByModelUri.delete(model.uri.toString());
}

/** Draws the host's diagnostics; an empty list clears them. */
export function applyLwqlMarkers({
  monaco,
  model,
  markers,
}: {
  monaco: Monaco;
  model: editor.ITextModel;
  markers: readonly LwqlEditorMarker[];
}): void {
  const severities = {
    error: monaco.MarkerSeverity.Error,
    warning: monaco.MarkerSeverity.Warning,
    info: monaco.MarkerSeverity.Info,
  };
  monaco.editor.setModelMarkers(
    model,
    MARKER_OWNER,
    markers.map((marker) => {
      const word = model.getWordAtPosition({ lineNumber: marker.line, column: marker.column });
      return {
        severity: severities[marker.severity ?? "error"],
        message: marker.message,
        startLineNumber: marker.line,
        startColumn: marker.column,
        endLineNumber: marker.endLine ?? marker.line,
        endColumn: marker.endColumn ?? word?.endColumn ?? marker.column + 1,
      };
    }),
  );
}

function ensureParamStyles(): void {
  if (document.getElementById(PARAM_STYLES_ID)) return;
  const style = document.createElement("style");
  style.id = PARAM_STYLES_ID;
  style.textContent = `
    .lw-sql-param-reserved { color: #3182CE; font-weight: 600; }
    .lw-sql-param-declared { color: #805AD5; font-weight: 600; }
    .lw-sql-param-undeclared { color: #DD6B20; font-weight: 600; text-decoration: underline wavy; }
  `;
  document.head.appendChild(style);
}

function paramClass({
  name,
  parameters,
}: {
  name: string;
  parameters: readonly LwqlParameter[];
}): string {
  const known = parameters.find((parameter) => parameter.name === name);
  if (!known) return "lw-sql-param-undeclared";
  return known.reserved ? "lw-sql-param-reserved" : "lw-sql-param-declared";
}

/** Colours every `{name:Type}` token as reserved, declared or undeclared. */
export function paramDecorations({
  model,
  parameters,
}: {
  model: editor.ITextModel;
  parameters: readonly LwqlParameter[];
}): editor.IModelDeltaDecoration[] {
  ensureParamStyles();
  return [...model.getValue().matchAll(PARAM_TOKEN)].flatMap((match) => {
    const name = match[1];
    if (!name || match.index === undefined) return [];
    return [
      {
        range: rangeOf({ model, start: match.index, end: match.index + match[0].length }),
        options: { inlineClassName: paramClass({ name, parameters }) },
      },
    ];
  });
}
