/**
 * The SQL editor, with assistance drawn from the live schema response —
 * suggestions are a projection of what the endpoint returned, nothing
 * more. Never rewrites what is typed, only marks refusal positions.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { Box } from "@chakra-ui/react";
import type { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { lazy, Suspense, useCallback, useState } from "react";

import { LWQL_LANGUAGE, useLangWatchQLMonaco } from "../../behavior/use-langwatch-ql-monaco.ts";
import type { LangWatchQLEditorMarker } from "../../model/lwql-failure.ts";
import type { LangWatchQLSchemaModel } from "../../model/lwql-schema-model.ts";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
  // Only Tab/Enter accept a highlighted suggestion, so ordinary punctuation
  // never swallows a keystroke while the widget is open.
  acceptSuggestionOnCommitCharacter: false,
};

/**
 * The editor is as tall as the statement, within reason: a few lines of
 * SQL get a few lines of editor, so the result keeps the rest of the page.
 * Past the ceiling, a long statement scrolls internally instead of pushing it off.
 */
const EDITOR_MIN_HEIGHT = 116;
const EDITOR_MAX_HEIGHT = 380;

function clampEditorHeight(contentHeight: number): number {
  return Math.min(EDITOR_MAX_HEIGHT, Math.max(EDITOR_MIN_HEIGHT, contentHeight));
}

export interface LangWatchQLEditorProps {
  sql: string;
  onChange: (sql: string) => void;
  /** The live schema, which is the whole of the editor's knowledge. */
  schema: LangWatchQLSchemaModel;
  /** Positions the backend refused, if it gave any. */
  markers: readonly LangWatchQLEditorMarker[];
  /**
   * Receives a writer that inserts text at the cursor once the editor is
   * mounted, and `null` when it unmounts. The schema browser inserts through
   * it; before it arrives the workbench appends instead.
   */
  registerInsert?: (insert: ((text: string) => void) | null) => void;
  /** Runs the draft. Bound to Cmd/Ctrl+Enter inside the editor. */
  onRun?: () => void;
  /** Theme is supplied by the application color-mode composition. */
  theme?: "vs" | "vs-dark";
}

export function LangWatchQLEditor({
  sql,
  onChange,
  schema,
  markers,
  registerInsert,
  onRun,
  theme = "vs",
}: LangWatchQLEditorProps) {
  const { handleMount, trackDisposable } = useLangWatchQLMonaco({
    schema,
    markers,
    ...(registerInsert ? { registerInsert } : {}),
    ...(onRun ? { onRun } : {}),
  });

  const [editorHeight, setEditorHeight] = useState(EDITOR_MIN_HEIGHT);
  const handleMountWithHeight: OnMount = useCallback(
    (instance, monaco) => {
      handleMount(instance, monaco);
      // Guarded, like the rest of the mount path: a test double of Monaco
      // stubs only what its test reads, and a missing sizing API must degrade
      // to the minimum height rather than crash.
      if (instance.getContentHeight && instance.onDidContentSizeChange) {
        const follow = () => setEditorHeight(clampEditorHeight(instance.getContentHeight()));
        // Handed to the hook, so this listener is released on unmount with the
        // providers registered beside it.
        trackDisposable(instance.onDidContentSizeChange(follow));
        follow();
      }
    },
    [handleMount, trackDisposable],
  );

  return (
    <Box height={`${editorHeight}px`} overflow="hidden" data-testid="lwql-editor">
      <Suspense
        fallback={
          <Box padding={4} color="fg.muted">
            Loading the editor
          </Box>
        }
      >
        <MonacoEditor
          height="100%"
          language={LWQL_LANGUAGE}
          value={sql}
          theme={theme}
          onChange={(value: string | undefined) => onChange(value ?? "")}
          onMount={handleMountWithHeight}
          options={EDITOR_OPTIONS}
        />
      </Suspense>
    </Box>
  );
}
