import { Box, Button, Flex } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useTraceStore } from "../traceStore";
import { JsonViewer } from "~/components/ops/JsonViewer";

export function JsonView() {
  const trace = useTraceStore((s) => s.trace);
  const [copied, setCopied] = useState(false);

  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Box p={4} minW={0} overflow="hidden">
      <Flex justify="flex-end" mb={2}>
        <Button size="xs" variant="outline" onClick={copyJson}>
          <Copy size={12} />
          {copied ? "Copied!" : "Copy JSON"}
        </Button>
      </Flex>
      <Box
        rounded="lg"
        border="1px solid"
        borderColor="border"
        bg="bg.subtle"
        p={4}
        overflow="auto"
        maxH="calc(100vh - 200px)"
      >
        <JsonViewer data={trace} />
      </Box>
    </Box>
  );
}
