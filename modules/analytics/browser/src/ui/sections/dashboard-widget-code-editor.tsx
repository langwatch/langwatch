/**
 * Dashboard widget TypeScript Monaco pane, shared by the in-card Code view and the
 * edit drawer so both never drift on wrapping, folding, font size or theme. Lazy import.
 * Query SQL is edited in the kit's `LwqlEditor`.
 */

import { useColorMode } from "@langwatch/design-system/color-mode";
import { Box } from "@langwatch/design-system/primitives";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { lazy, Suspense, useMemo, useState } from "react";

import { configureWidgetTypeScript, useWidgetRowTypes } from "../../behavior/lw-widget-monaco.ts";
import {
  type LwQueryColumnsByName,
  lwQueryRowTypesDts,
} from "../../model/dashboard-widget/lw-query-row-types.ts";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 12,
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
  lineNumbers: "on",
  folding: true,
};

interface DashboardWidgetCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** The columns each query returned on its last run; types `rows[0].<column>`. */
  queryColumns: readonly LwQueryColumnsByName[];
}

export function DashboardWidgetCodeEditor({
  value,
  onChange,
  queryColumns,
}: DashboardWidgetCodeEditorProps) {
  const { colorMode } = useColorMode();
  const [mounted, setMounted] = useState<{ readonly monaco: Monaco }>();
  const rowTypes = useMemo(() => lwQueryRowTypesDts({ queries: queryColumns }), [queryColumns]);
  useWidgetRowTypes({ mounted, dts: rowTypes });

  return (
    <Suspense
      fallback={
        <Box padding={4} color="fg.muted">
          Loading the editor
        </Box>
      }
    >
      <MonacoEditor
        height="100%"
        language="typescript"
        value={value}
        theme={colorMode === "dark" ? "vs-dark" : "vs"}
        onChange={(v: string | undefined) => onChange(v ?? "")}
        options={EDITOR_OPTIONS}
        beforeMount={(instance) => configureWidgetTypeScript({ monaco: instance })}
        onMount={(_editor, instance) => setMounted({ monaco: instance })}
      />
    </Suspense>
  );
}
