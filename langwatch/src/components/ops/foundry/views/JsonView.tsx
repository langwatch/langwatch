import { Badge, Box, Button, HStack, Text } from "@chakra-ui/react";
import type { Monaco } from "@monaco-editor/react";
import dynamic from "~/utils/compat/next-dynamic";
import { useMemo, useRef, useState } from "react";
import { Copy, Check, RotateCcw, WrapText } from "lucide-react";
import { useTraceStore } from "../traceStore";
import { useColorMode } from "~/components/ui/color-mode";
import { traceConfigJsonSchema } from "./traceConfigSchema";
import type { SpanConfig } from "../types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

function countSpans(spans: SpanConfig[]): number {
  return spans.reduce((n, s) => n + 1 + countSpans(s.children), 0);
}

export function JsonView() {
  const trace = useTraceStore((s) => s.trace);
  const setTrace = useTraceStore((s) => s.setTrace);
  const resetTrace = useTraceStore((s) => s.resetTrace);
  const { colorMode } = useColorMode();
  const [copied, setCopied] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const editorRef = useRef<{ getValue: () => string } | null>(null);

  const jsonString = useMemo(
    () => JSON.stringify(trace, null, 2),
    [trace],
  );

  const spanCount = useMemo(() => countSpans(trace.spans), [trace.spans]);
  const lineCount = jsonString.split("\n").length;

  function handleChange(value: string | undefined) {
    if (!value) return;
    try {
      const parsed = JSON.parse(value);
      setTrace(parsed);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  function handleCopy() {
    const value = editorRef.current?.getValue() ?? jsonString;
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleFormat() {
    const value = editorRef.current?.getValue();
    if (!value) return;
    try {
      const parsed = JSON.parse(value);
      setTrace(parsed);
      setParseError(null);
    } catch {
      // can't format invalid JSON
    }
  }

  return (
    <Box h="full" w="full" minH={0} display="flex" flexDirection="column">
      <HStack
        px={3}
        py={1.5}
        borderBottom="1px solid"
        borderColor="border"
        bg="bg.subtle"
        flexShrink={0}
        gap={2}
        justify="space-between"
      >
        <HStack gap={2}>
          <Badge size="sm" variant="outline">
            {spanCount} {spanCount === 1 ? "span" : "spans"}
          </Badge>
          <Badge size="sm" variant="outline">
            {lineCount} lines
          </Badge>
          {parseError ? (
            <Text fontSize="xs" color="red.400" truncate maxW="300px">
              {parseError}
            </Text>
          ) : (
            <Text fontSize="xs" color="green.500">
              Valid
            </Text>
          )}
        </HStack>
        <HStack gap={1}>
          <Button size="2xs" variant="ghost" onClick={handleFormat} title="Format">
            <WrapText size={12} />
          </Button>
          <Button size="2xs" variant="ghost" onClick={handleCopy} title="Copy">
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </Button>
          <Button size="2xs" variant="ghost" onClick={resetTrace} title="Reset to default">
            <RotateCcw size={12} />
          </Button>
        </HStack>
      </HStack>

      <Box flex={1} minH={0}>
        <MonacoEditor
          height="100%"
          language="json"
          value={jsonString}
          onChange={handleChange}
          theme={colorMode === "dark" ? "vs-dark" : "light"}
          onMount={(editor: { getValue: () => string }) => {
            editorRef.current = editor;
          }}
          beforeMount={(monaco: Monaco) => {
            monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
              validate: true,
              allowComments: false,
              trailingCommas: "error",
              schemas: [
                {
                  uri: "https://langwatch.ai/schemas/trace-config.json",
                  fileMatch: ["*"],
                  schema: traceConfigJsonSchema,
                },
              ],
            });
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: "on",
            formatOnPaste: true,
          }}
        />
      </Box>
    </Box>
  );
}
