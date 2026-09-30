/**
 * Dashboard widget TypeScript Monaco pane, shared by the in-card Code view and the
 * edit drawer so both never drift on wrapping, folding, font size or theme. Lazy import.
 * Query SQL is edited in the kit's `LwqlEditor`.
 */

import { Box } from "@chakra-ui/react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import type { BeforeMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { lazy, Suspense } from "react";

import { LW_GLOBAL_DTS } from "../../model/dashboard-widget/lw-global-types.ts";

const LW_GLOBAL_DTS_URI = "file:///lw-global.d.ts";

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

/**
 * Monaco's TypeScript worker checks against an ambient lib that knows
 * nothing of this repo, so semantic validation is all false positives and
 * turned off. `jsx` must still be set or the parser rejects TSX outright.
 */
const configureTypeScriptDefaults: BeforeMount = (monaco) => {
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
  });
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  // Guard against re-registering on every mount (both the in-card Code view
  // and the edit drawer call this) — addExtraLib would otherwise stack
  // duplicate libs under the same content each time a pane mounts.
  const alreadyRegistered =
    monaco.languages.typescript.typescriptDefaults.getExtraLibs()[LW_GLOBAL_DTS_URI] !== undefined;
  if (!alreadyRegistered) {
    monaco.languages.typescript.typescriptDefaults.addExtraLib(LW_GLOBAL_DTS, LW_GLOBAL_DTS_URI);
  }
};

interface DashboardWidgetCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function DashboardWidgetCodeEditor({ value, onChange }: DashboardWidgetCodeEditorProps) {
  const { colorMode } = useColorMode();

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
        beforeMount={configureTypeScriptDefaults}
      />
    </Suspense>
  );
}
