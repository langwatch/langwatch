import { Box } from "@chakra-ui/react";
import type { Monaco } from "@monaco-editor/react";
import dynamic from "~/utils/compat/next-dynamic";
import { useMemo } from "react";
import { useTraceStore } from "../traceStore";
import monokaiTheme from "~/optimization_studio/components/code/Monokai.json";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

export function JsonView() {
  const trace = useTraceStore((s) => s.trace);
  const setTrace = useTraceStore((s) => s.setTrace);

  const jsonString = useMemo(
    () => JSON.stringify(trace, null, 2),
    [trace],
  );

  function handleChange(value: string | undefined) {
    if (!value) return;
    try {
      const parsed = JSON.parse(value);
      setTrace(parsed);
    } catch {
      // invalid JSON while typing — ignore
    }
  }

  return (
    <Box h="full" w="full">
      <MonacoEditor
        height="100%"
        language="json"
        value={jsonString}
        onChange={handleChange}
        theme="monokai"
        beforeMount={(monaco: Monaco) => {
          monaco.editor.defineTheme(
            "monokai",
            monokaiTheme as Parameters<typeof monaco.editor.defineTheme>[1],
          );

          monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: false,
            trailingCommas: "error",
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
          readOnly: false,
        }}
      />
    </Box>
  );
}
