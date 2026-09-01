/**
 * The playground's Monaco pane: one dynamic import and one set of editor
 * options, shared by the in-card Code view and the edit drawer so the two
 * surfaces can never drift on wrapping, folding, font size or theme.
 *
 * The import stays lazy — Monaco is large, and a page of chart widgets should
 * pay for it only once someone actually opens code.
 */

import { Box } from "@chakra-ui/react";
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

interface PlaygroundCodeEditorProps {
  language: "html" | "sql";
  value: string;
  onChange: (value: string) => void;
}

export function PlaygroundCodeEditor({
  language,
  value,
  onChange,
}: PlaygroundCodeEditorProps) {
  const { colorMode } = useColorMode();

  return (
    <MonacoEditor
      height="100%"
      language={language}
      value={value}
      theme={colorMode === "dark" ? "vs-dark" : "vs"}
      onChange={(v: string | undefined) => onChange(v ?? "")}
      options={EDITOR_OPTIONS}
    />
  );
}
