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
 * @see specs/analytics/governed-sql-workbench.feature
 */

import type { Monaco, OnMount } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";

import {
  type GovernedSchemaModel,
  governedSqlCompletionItems,
  governedSqlHoverFor,
} from "../logic/governedSchemaModel";
import type { GovernedSqlEditorMarker } from "../logic/governedSqlFailure";

type MonacoEditorInstance = editor.IStandaloneCodeEditor;

/** Monaco's own SQL language. Highlighting only; the policy is the backend's. */
export const GOVERNED_SQL_LANGUAGE = "sql";

/**
 * Namespaces the markers this editor sets, so clearing ours never clears
 * Monaco's own syntax diagnostics.
 */
const GOVERNED_SQL_MARKER_OWNER = "governed-sql";

/** Reads the schema at call time, so a provider never closes over a stale one. */
type ReadSchema = () => GovernedSchemaModel;

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
      return {
        suggestions: governedSqlCompletionItems(readSchema()).map((item) => ({
          label: item.label,
          kind:
            item.kind === "dataset"
              ? monaco.languages.CompletionItemKind.Struct
              : monaco.languages.CompletionItemKind.Field,
          insertText: item.insertText,
          detail: item.detail,
          documentation: item.documentation,
          range,
        })),
      };
    },
  };
}

/** Hover copy for a governed identifier, or nothing when the schema has none. */
function hoverProvider({
  readSchema,
}: {
  readSchema: ReadSchema;
}): languages.HoverProvider {
  return {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const hover = governedSqlHoverFor({
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
  marker: GovernedSqlEditorMarker;
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

  instance.executeEdits(GOVERNED_SQL_MARKER_OWNER, [
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

export interface UseGovernedSqlMonaco {
  /** Hand this to `<Editor onMount>`. */
  handleMount: OnMount;
}

export function useGovernedSqlMonaco({
  schema,
  markers,
  registerInsert,
  onRun,
}: {
  schema: GovernedSchemaModel;
  markers: readonly GovernedSqlEditorMarker[];
  registerInsert?: (insert: ((text: string) => void) | null) => void;
  /** Bound to Cmd/Ctrl+Enter inside the editor. */
  onRun?: () => void;
}): UseGovernedSqlMonaco {
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  // Through a ref, so the command Monaco keeps for the life of the editor
  // always calls the current handler rather than the one from mount time.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);

  const applyMarkers = useCallback(
    (next: readonly GovernedSqlEditorMarker[]) => {
      const monaco = monacoRef.current;
      const model = editorRef.current?.getModel();
      if (!monaco || !model) return;

      monaco.editor.setModelMarkers(
        model,
        GOVERNED_SQL_MARKER_OWNER,
        next.map((marker) => markerDataFor({ monaco, marker })),
      );
    },
    [],
  );

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
        GOVERNED_SQL_LANGUAGE,
        completionProvider({ monaco, readSchema }),
      ),
      monaco.languages.registerHoverProvider(
        GOVERNED_SQL_LANGUAGE,
        hoverProvider({ readSchema }),
      ),
    );

    registerInsert?.((text: string) =>
      insertAtCursor({ editor: instance, text }),
    );

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

  return { handleMount };
}
