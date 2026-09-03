/**
 * The dashboard widget author's Monaco pane: one dynamic import and one set of editor
 * options, shared by the in-card Code view and the edit drawer so the two
 * surfaces can never drift on wrapping, folding, font size or theme.
 *
 * The import stays lazy — Monaco is large, and a page of chart widgets should
 * pay for it only once someone actually opens code.
 */

import { Box } from "@chakra-ui/react";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import { RESERVED_PARAMETERS } from "~/server/analytics/dashboardWidgetDefinition";
import dynamic from "~/utils/compat/next-dynamic";

import { LW_GLOBAL_DTS } from "./bridge/lwGlobalTypes";

const LW_GLOBAL_DTS_URI = "file:///lw-global.d.ts";

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

  // Guard against re-registering on every mount (both the in-card Code view
  // and the edit drawer call this) — addExtraLib would otherwise stack
  // duplicate libs under the same content each time a pane mounts.
  const alreadyRegistered =
    monaco.languages.typescript.typescriptDefaults
      .getExtraLibs()[LW_GLOBAL_DTS_URI] !== undefined;
  if (!alreadyRegistered) {
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      LW_GLOBAL_DTS,
      LW_GLOBAL_DTS_URI,
    );
  }
};

/** Matches ClickHouse bound-param tokens like `{dashboard_context_period_start:DateTime}`. */
const BOUND_PARAM_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*):[A-Za-z0-9_]+\}/g;

const RESERVED_PARAM_NAMES = new Set(RESERVED_PARAMETERS.map((p) => p.name));

const PARAM_TOKEN_CLASS_RESERVED = "lw-sql-param-reserved";
const PARAM_TOKEN_CLASS_DECLARED = "lw-sql-param-declared";
const PARAM_TOKEN_CLASS_UNDECLARED = "lw-sql-param-undeclared";

/**
 * One shared stylesheet for the three token classes below — injected once,
 * since decorations only carry a className, not inline colors. Colors are
 * fixed (not theme-derived) because they must read clearly on both the
 * `vs` and `vs-dark` Monaco themes this editor switches between.
 */
function ensureParamTokenStyles() {
  const id = "lw-sql-param-token-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .${PARAM_TOKEN_CLASS_RESERVED} { color: #3182CE; font-weight: 600; }
    .${PARAM_TOKEN_CLASS_DECLARED} { color: #805AD5; font-weight: 600; }
    .${PARAM_TOKEN_CLASS_UNDECLARED} { color: #DD6B20; font-weight: 600; text-decoration: underline wavy; }
  `;
  document.head.appendChild(style);
}

interface DashboardWidgetCodeEditorProps {
  /** Monaco's "typescript" language id highlights JSX/TSX too. */
  language: "typescript" | "sql";
  value: string;
  onChange: (value: string) => void;
  /**
   * Names of this query's user-declared parameters — only used for `sql` to
   * color `{name:Type}` tokens as reserved / declared / undeclared. Reserved
   * names always come from `RESERVED_PARAMETERS`, not this list.
   */
  declaredParamNames?: string[];
}

export function DashboardWidgetCodeEditor({
  language,
  value,
  onChange,
  declaredParamNames,
}: DashboardWidgetCodeEditorProps) {
  const { colorMode } = useColorMode();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(
    null,
  );

  const updateDecorations = useRef(() => {});
  updateDecorations.current = () => {
    const ed = editorRef.current;
    if (!ed || language !== "sql") return;
    const model = ed.getModel();
    if (!model) return;

    const declared = new Set(declaredParamNames ?? []);
    const text = model.getValue();
    const newDecorations: editor.IModelDeltaDecoration[] = [];
    for (const match of text.matchAll(BOUND_PARAM_PATTERN)) {
      const name = match[1];
      if (!name || match.index === undefined) continue;
      const startPos = model.getPositionAt(match.index);
      const endPos = model.getPositionAt(match.index + match[0].length);
      const className = RESERVED_PARAM_NAMES.has(name)
        ? PARAM_TOKEN_CLASS_RESERVED
        : declared.has(name)
          ? PARAM_TOKEN_CLASS_DECLARED
          : PARAM_TOKEN_CLASS_UNDECLARED;
      newDecorations.push({
        range: {
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
        },
        options: { inlineClassName: className },
      });
    }

    if (!decorationsRef.current) {
      decorationsRef.current = ed.createDecorationsCollection(newDecorations);
    } else {
      decorationsRef.current.set(newDecorations);
    }
  };

  // Re-run whenever the value or the declared-param list changes (typing a
  // param name in the params editor should recolor tokens without an edit).
  useEffect(() => {
    updateDecorations.current();
  }, [value, declaredParamNames, language]);

  const handleMount: OnMount = (mountedEditor) => {
    ensureParamTokenStyles();
    editorRef.current = mountedEditor;
    updateDecorations.current();
  };

  return (
    <MonacoEditor
      height="100%"
      language={language}
      value={value}
      theme={colorMode === "dark" ? "vs-dark" : "vs"}
      onChange={(v: string | undefined) => onChange(v ?? "")}
      onMount={handleMount}
      options={EDITOR_OPTIONS}
      beforeMount={
        language === "typescript" ? configureTypeScriptDefaults : undefined
      }
    />
  );
}
