/**
 * The dashboard widget author's Monaco pane: one dynamic import and one set of editor
 * options, shared by the in-card Code view and the edit drawer so the two
 * surfaces can never drift on wrapping, folding, font size or theme.
 *
 * The import stays lazy — Monaco is large, and a page of chart widgets should
 * pay for it only once someone actually opens code.
 */

import { Box } from "@chakra-ui/react";
import type { BeforeMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

import { useColorMode } from "~/components/ui/color-mode";
import dynamic from "~/utils/compat/next-dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading the editor
    </Box>
  ),
});

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
 * Monaco's TypeScript worker checks a widget file against an ambient
 * lib/tsconfig that has never heard of this repo, `react`, or `recharts` —
 * left alone, every author file is a wall of red squiggles for imports and
 * JSX that compile and run fine (Babel does the real transpile; see
 * `bridge/authorRuntime.ts`). Semantic validation is what produces those
 * ("cannot find module", "implicit any" on JSX) and is the half with no
 * signal here, so it's turned off; syntax validation stays on — an actual
 * unmatched brace or broken JSX tag is still worth flagging inline. JSX
 * parsing itself needs `jsx` set or Monaco's parser rejects TSX syntax
 * outright, error or not.
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
};

interface DashboardWidgetCodeEditorProps {
  /** Monaco's "typescript" language id highlights JSX/TSX too. */
  language: "typescript" | "sql";
  value: string;
  onChange: (value: string) => void;
}

export function DashboardWidgetCodeEditor({
  language,
  value,
  onChange,
}: DashboardWidgetCodeEditorProps) {
  const { colorMode } = useColorMode();

  return (
    <MonacoEditor
      height="100%"
      language={language}
      value={value}
      theme={colorMode === "dark" ? "vs-dark" : "vs"}
      onChange={(v: string | undefined) => onChange(v ?? "")}
      options={EDITOR_OPTIONS}
      beforeMount={
        language === "typescript" ? configureTypeScriptDefaults : undefined
      }
    />
  );
}
