/**
 * Everything the SQL editor teaches Monaco, and everything it takes back.
 *
 * Kept out of the component because it is lifecycle rather than markup:
 * providers registered once per mount and disposed on unmount, a schema read
 * through a ref so a fresh response never leaves two providers answering the
 * same request, and the markers a refusal named.
 *
 * The assistance is the schema response and nothing else. No dataset, column or
 * physical table name is written here.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import type { Monaco, OnMount } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import type { LangWatchQLEditorMarker } from "../logic/lwql-failure";
import { LWQL_LANGUAGE_ITEMS } from "../logic/lwql-language-items";
import {
  type LangWatchQLSchemaModel,
  lwqlCompletionItems,
  lwqlHoverFor,
} from "../logic/lwql-schema-model";

type MonacoEditorInstance = editor.IStandaloneCodeEditor;

/** Monaco's own SQL language. Highlighting only; the policy is the backend's. */
export const LWQL_LANGUAGE = "sql";

/**
 * Namespaces the markers this editor sets, so clearing ours never clears
 * Monaco's own syntax diagnostics.
 */
const LWQL_MARKER_OWNER = "lwql";

/** Reads the schema at call time, so a provider never closes over a stale one. */
type ReadSchema = () => LangWatchQLSchemaModel;

/**
 * Suggestions, drawn from the live schema every time the widget opens.
 *
 * The range comes from the word being typed, so accepting an entry replaces
 * that word rather than appending to it.
 */
function completionProvider({
  monaco,
  readSchema,
}: {
  monaco: Monaco;
  readSchema: ReadSchema;
}): languages.CompletionItemProvider {
  return {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const schemaSuggestions = lwqlCompletionItems(readSchema()).map((item) => ({
        label: item.label,
        kind:
          item.kind === "dataset"
            ? monaco.languages.CompletionItemKind.Struct
            : monaco.languages.CompletionItemKind.Field,
        insertText: item.insertText,
        detail: item.detail,
        documentation: item.documentation,
        range,
      }));
      // Keywords rank ahead of identifiers on an equal fuzzy match, so a
      // member typing "sel" is offered SELECT before a column that happens to
      // start with the same letters.
      const languageSuggestions = LWQL_LANGUAGE_ITEMS.map((item) =>
        item.kind === "keyword"
          ? {
              label: item.label,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: item.label,
              detail: item.detail,
              sortText: `0 ${item.label}`,
              range,
            }
          : {
              label: item.label,
              kind: monaco.languages.CompletionItemKind.Function,
              // A snippet, so accepting `count` leaves the cursor between the
              // parentheses it will want to fill.
              insertText: `${item.label}($0)`,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule?.InsertAsSnippet,
              detail: item.detail,
              range,
            },
      );
      return { suggestions: [...schemaSuggestions, ...languageSuggestions] };
    },
  };
}

/** Hover copy for a LangWatchQL identifier, or nothing when the schema has none. */
function hoverProvider({
  readSchema,
}: {
  readSchema: ReadSchema;
}): languages.HoverProvider {
  return {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const hover = lwqlHoverFor({
        model: readSchema(),
        identifier: word.word,
      });
      if (!hover) return null;

      return {
        contents: [
          { value: `**${hover.title}**` },
          { value: `\`${hover.detail}\`` },
          { value: hover.documentation },
        ],
      };
    },
  };
}

/**
 * The backend reports a point, not a span. One column wide is the honest
 * rendering of that: guessing an end would underline text the parser never
 * blamed.
 */
function markerDataFor({
  monaco,
  marker,
}: {
  monaco: Monaco;
  marker: LangWatchQLEditorMarker;
}): editor.IMarkerData {
  return {
    severity: monaco.MarkerSeverity.Error,
    message: marker.message,
    startLineNumber: marker.line,
    startColumn: marker.column,
    endLineNumber: marker.line,
    endColumn: marker.column + 1,
  };
}

function insertAtCursor({
  editor: instance,
  text,
}: {
  editor: MonacoEditorInstance;
  text: string;
}): void {
  const position = instance.getPosition();
  if (!position) return;

  instance.executeEdits(LWQL_MARKER_OWNER, [
    {
      range: {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column,
        endColumn: position.column,
      },
      text,
      forceMoveMarkers: true,
    },
  ]);
  instance.focus();
}

export interface UseLangWatchQLMonaco {
  /** Hand this to `<Editor onMount>`. */
  handleMount: OnMount;
  /**
   * Adopts a disposable the component registered on the same editor, so
   * everything attached at mount is released together on unmount rather than
   * outliving the editor it listens to.
   */
  trackDisposable: (disposable: { dispose: () => void }) => void;
}

export function useLangWatchQLMonaco({
  schema,
  markers,
  registerInsert,
  onRun,
}: {
  schema: LangWatchQLSchemaModel;
  markers: readonly LangWatchQLEditorMarker[];
  registerInsert?: (insert: ((text: string) => void) | null) => void;
  /** Bound to Cmd/Ctrl+Enter inside the editor. */
  onRun?: () => void;
}): UseLangWatchQLMonaco {
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  // Through a ref, so the command Monaco keeps for the life of the editor
  // always calls the current handler rather than the one from mount time.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);

  const trackDisposable = useCallback((disposable: { dispose: () => void }) => {
    disposablesRef.current.push(disposable);
  }, []);

  const applyMarkers = useCallback((next: readonly LangWatchQLEditorMarker[]) => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;

    monaco.editor.setModelMarkers(
      model,
      LWQL_MARKER_OWNER,
      next.map((marker) => markerDataFor({ monaco, marker })),
    );
  }, []);

  useEffect(() => {
    applyMarkers(markers);
  }, [applyMarkers, markers]);

  useEffect(
    () => () => {
      for (const disposable of disposablesRef.current) disposable.dispose();
      disposablesRef.current = [];
      editorRef.current = null;
      monacoRef.current = null;
      registerInsert?.(null);
    },
    [registerInsert],
  );

  const handleMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    const readSchema: ReadSchema = () => schemaRef.current;

    disposablesRef.current.push(
      monaco.languages.registerCompletionItemProvider(
        LWQL_LANGUAGE,
        completionProvider({ monaco, readSchema }),
      ),
      monaco.languages.registerHoverProvider(
        LWQL_LANGUAGE,
        hoverProvider({ readSchema }),
      ),
    );

    registerInsert?.((text: string) => insertAtCursor({ editor: instance, text }));

    // Guarded, because test doubles of Monaco routinely stub only what a
    // given test reads — a missing key table must degrade to "no shortcut",
    // never to a crash on mount.
    if (monaco.KeyMod && monaco.KeyCode && instance.addCommand) {
      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        onRunRef.current?.();
      });
    }

    applyMarkers(markers);
  };

  return { handleMount, trackDisposable };
}
