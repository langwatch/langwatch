/**
 * The one LangWatchQL editor: grammar, completion and hover from the live schema, and the
 * host's diagnostics as markers. The Monaco import stays lazy since Monaco is large.
 */

import type { LangWatchQLSchema } from "@langwatch/analytics-contract";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Box } from "@langwatch/design-system/primitives";
import type { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { lazy, Suspense, useId, useState } from "react";

import { registerLwqlLanguage } from "../../behavior/lwql-monaco.ts";
import { useLwqlModelSync, type LwqlMountedEditor } from "../../behavior/use-lwql-model-sync.ts";
import type { LwqlParameter } from "../../model/lwql-language/lwql-completion.ts";
import type { LwqlEditorMarker } from "../../model/lwql-language/lwql-marker.ts";
import { LWQL_LANGUAGE_ID } from "../../model/lwql-language/lwql-monarch.ts";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const NO_PARAMETERS: readonly LwqlParameter[] = [];
const NO_MARKERS: readonly LwqlEditorMarker[] = [];

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 12,
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
  lineNumbers: "on",
  folding: true,
  fixedOverflowWidgets: true,
  quickSuggestions: true,
};

export type LwqlEditorProps = Readonly<{
  /** The live schema; undefined while loading or when the read failed, which fails open. */
  schema: LangWatchQLSchema | undefined;
  value: string;
  onChange: (value: string) => void;
  height?: string | number;
  readOnly?: boolean;
  markers?: readonly LwqlEditorMarker[];
  /** Bound parameters the host offers and colours: reserved, declared, and the rest undeclared. */
  parameters?: readonly LwqlParameter[];
}>;

export function LwqlEditor({
  schema,
  value,
  onChange,
  height = "100%",
  readOnly = false,
  markers = NO_MARKERS,
  parameters = NO_PARAMETERS,
}: LwqlEditorProps) {
  const { colorMode } = useColorMode();
  const [mounted, setMounted] = useState<LwqlMountedEditor | null>(null);
  const modelPath = `inmemory://lwql/${useId().replaceAll(":", "")}.lwql`;

  useLwqlModelSync({ mounted, schema, parameters, markers, value });

  const handleMount: OnMount = (mountedEditor, monaco) =>
    setMounted({ editor: mountedEditor, monaco });

  return (
    <Box height={height} display="flex" flexDirection="column">
      <Box flex={1} minHeight={0}>
        <Suspense
          fallback={
            <Box padding={4} color="fg.muted">
              Loading the editor
            </Box>
          }
        >
          <MonacoEditor
            height="100%"
            path={modelPath}
            language={LWQL_LANGUAGE_ID}
            value={value}
            theme={colorMode === "dark" ? "vs-dark" : "vs"}
            onChange={(next: string | undefined) => onChange(next ?? "")}
            beforeMount={registerLwqlLanguage}
            onMount={handleMount}
            options={{ ...EDITOR_OPTIONS, readOnly }}
          />
        </Suspense>
      </Box>
    </Box>
  );
}
