import { Box } from "@chakra-ui/react";
import type { Monaco } from "@monaco-editor/react";
import { useCallback } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import dynamic from "~/utils/compat/next-dynamic";
import { vscodeThemeName } from "./CodeEditorModal";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <Box height="38px" />,
});

const LANGUAGE_ID = "liquid-condition";

let languageRegistered = false;

/**
 * Monarch grammar for the body of a Liquid `{% if %}` expression: the
 * condition input holds the bare expression (no tag braces), so the
 * grammar only needs operators, literals, and identifiers.
 */
function ensureLiquidConditionLanguage(monaco: Monaco) {
  if (languageRegistered) return;
  languageRegistered = true;

  monaco.languages.register({ id: LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    ignoreCase: false,
    tokenizer: {
      root: [
        [/\b(and|or|not|contains)\b/, "keyword"],
        [/\b(true|false|nil|null|empty|blank)\b/, "constant"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/\d+(\.\d+)?/, "number"],
        [/(==|!=|>=|<=|>|<)/, "operators"],
        [/[A-Za-z_]\w*(\.[A-Za-z_]\w*)*/, "identifier"],
      ],
    },
  });
}

/**
 * Single-line Monaco editor for the if/else Liquid condition: syntax
 * highlighting without the full code-editor chrome (no line numbers,
 * minimap, or folding). Newlines are stripped on change since the
 * condition is one expression.
 */
export function LiquidConditionEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { colorMode } = useColorMode();

  const handleChange = useCallback(
    (newValue: string | undefined) => {
      onChange((newValue ?? "").replace(/\r?\n/g, " "));
    },
    [onChange],
  );

  return (
    <Box
      width="full"
      height="38px"
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      paddingY="8px"
      overflow="hidden"
      data-testid="if-else-condition-input"
    >
      <MonacoEditor
        height="22px"
        language={LANGUAGE_ID}
        theme={vscodeThemeName(colorMode === "dark" ? "dark" : "light")}
        value={value}
        beforeMount={ensureLiquidConditionLanguage}
        onChange={handleChange}
        options={{
          lineNumbers: "off",
          minimap: { enabled: false },
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 0,
          renderLineHighlight: "none",
          scrollBeyondLastLine: false,
          scrollbar: {
            vertical: "hidden",
            horizontal: "hidden",
            handleMouseWheel: false,
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          wordWrap: "off",
          fontSize: 13,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
          placeholder,
          fixedOverflowWidgets: true,
          contextmenu: false,
        }}
      />
    </Box>
  );
}
