import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import dynamic from "~/utils/compat/next-dynamic";
import { vscodeThemeName } from "./CodeEditorModal";
import { validateLiquidCondition } from "./validateLiquidCondition";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <Box height="22px" flex="1" />,
});

const LANGUAGE_ID = "liquid-condition";
const MARKER_OWNER = "liquid-condition";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Single-line Monaco editor for the if/else Liquid condition. Beyond syntax
 * highlighting it validates the expression live (via liquidjs, the same way
 * the engine evaluates it): a malformed expression shows a red error and a
 * reference to an input that does not exist shows an orange warning, both as
 * Monaco squiggles and an inline message. The `{%`/`%}` adornments signal
 * that the field is a Liquid condition; the stored value stays the bare
 * expression.
 */
export function LiquidConditionEditor({
  value,
  onChange,
  placeholder,
  availableVariables = [],
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  availableVariables?: string[];
}) {
  const { colorMode } = useColorMode();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const validation = useMemo(
    () => validateLiquidCondition(value, availableVariables),
    [value, availableVariables],
  );

  const handleChange = useCallback(
    (newValue: string | undefined) => {
      onChange((newValue ?? "").replace(/\r?\n/g, " "));
    },
    [onChange],
  );

  const applyMarkers = useCallback(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;

    const markers: editor.IMarkerData[] = [];
    if (validation.error) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: validation.error,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: Math.max(2, value.length + 1),
      });
    }
    for (const name of validation.missingVariables) {
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(value)) !== null) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: `Unknown input "${name}" — add it below or fix the name.`,
          startLineNumber: 1,
          startColumn: match.index + 1,
          endLineNumber: 1,
          endColumn: match.index + 1 + name.length,
        });
      }
    }
    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }, [validation, value]);

  const handleMount = useCallback(
    (mountedEditor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = mountedEditor;
      monacoRef.current = monaco;
      applyMarkers();
    },
    [applyMarkers],
  );

  useEffect(() => {
    applyMarkers();
  }, [applyMarkers]);

  const borderColor = validation.error
    ? "red.400"
    : validation.missingVariables.length > 0
      ? "orange.400"
      : "border";

  return (
    <VStack width="full" align="start" gap={1}>
      <HStack
        width="full"
        height="38px"
        border="1px solid"
        borderColor={borderColor}
        borderRadius="md"
        paddingX="8px"
        gap="6px"
        overflow="hidden"
        data-testid="if-else-condition-input"
      >
        <Text
          fontFamily="mono"
          fontSize="13px"
          color="fg.muted"
          userSelect="none"
        >
          {"{%"}
        </Text>
        <Box flex="1" minWidth="0" height="22px">
          <MonacoEditor
            height="22px"
            language={LANGUAGE_ID}
            theme={vscodeThemeName(colorMode === "dark" ? "dark" : "light")}
            value={value}
            beforeMount={ensureLiquidConditionLanguage}
            onMount={handleMount}
            onChange={handleChange}
            options={{
              lineNumbers: "off",
              minimap: { enabled: false },
              folding: false,
              glyphMargin: false,
              lineDecorationsWidth: 0,
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
              automaticLayout: true,
            }}
          />
        </Box>
        <Text
          fontFamily="mono"
          fontSize="13px"
          color="fg.muted"
          userSelect="none"
        >
          {"%}"}
        </Text>
      </HStack>
      {validation.error ? (
        <Text
          fontSize="12px"
          color="red.500"
          data-testid="if-else-condition-error"
        >
          {validation.error}
        </Text>
      ) : validation.missingVariables.length > 0 ? (
        <Text
          fontSize="12px"
          color="orange.600"
          data-testid="if-else-condition-warning"
        >
          Unknown input
          {validation.missingVariables.length > 1 ? "s" : ""}:{" "}
          {validation.missingVariables.join(", ")}
        </Text>
      ) : null}
    </VStack>
  );
}
