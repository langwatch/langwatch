import { useState } from "react";
import { Box, Flex, Text, Input, Button, VStack } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTraceStore } from "./traceStore";
import { useExecutionStore } from "./executionStore";
import { useFoundryProjectStore } from "./foundryProjectStore";

export function ExecutionControls({ compact = false }: { compact?: boolean }) {
  const { batchCount, staggerMs, running, setBatchCount, setStaggerMs, setRunning, addLogEntry, updateLogEntry } = useExecutionStore();
  const trace = useTraceStore((s) => s.trace);
  const { project } = useOrganizationTeamProject();
  const selectedApiKey = useFoundryProjectStore((s) => s.selectedApiKey);
  const apiKey = selectedApiKey ?? project?.apiKey;

  async function handleSend() {
    if (running || !apiKey) return;
    setRunning(true);
    for (let i = 0; i < batchCount; i++) {
      const logId = `log-${Date.now()}-${i}`;
      addLogEntry({ id: logId, traceId: logId, timestamp: Date.now(), status: "pending" });
      try {
        const { executeTrace } = await import("./traceExecutor");
        const traceId = await executeTrace({
          trace,
          apiKey,
          endpoint: window.location.origin,
        });
        updateLogEntry(logId, { status: "success", traceId });
      } catch (err) {
        updateLogEntry(logId, { status: "error", error: err instanceof Error ? err.message : "Send failed" });
      }
      if (staggerMs > 0 && i < batchCount - 1) await new Promise((r) => setTimeout(r, staggerMs));
    }
    setRunning(false);
  }

  return (
    <Box p={3}>
      <Text fontSize="xs" fontWeight="medium" textTransform="uppercase" letterSpacing="wider" color="gray.500" mb={2}>Execution</Text>
      <Flex gap={2} mb={2}>
        <Box flex={1}>
          <Text fontSize="xs" color="gray.400" mb={1}>Run N times</Text>
          <Input size="sm" type="number" value={batchCount} onChange={(e) => setBatchCount(parseInt(e.target.value) || 1)} min={1} max={100} />
        </Box>
        {!compact && (
          <Box flex={1}>
            <Text fontSize="xs" color="gray.400" mb={1}>Stagger (ms)</Text>
            <Input size="sm" type="number" value={staggerMs} onChange={(e) => setStaggerMs(parseInt(e.target.value) || 0)} min={0} step={100} />
          </Box>
        )}
      </Flex>
      <Button w="full" size="sm" colorPalette="orange" onClick={handleSend} disabled={running || !apiKey} loading={running} loadingText="Sending...">
        <Play size={14} /> Send Traces
      </Button>
      {!apiKey && <Text fontSize="xs" color="gray.500" mt={1}>Navigate to a project first</Text>}
      <ExecutionLog />
    </Box>
  );
}

function ExecutionLog() {
  const log = useExecutionStore((s) => s.log);
  const clearLog = useExecutionStore((s) => s.clearLog);
  if (log.length === 0) return null;
  return (
    <Box mt={2}>
      <Flex justify="space-between" align="center" mb={1}>
        <Text fontSize="xs" color="gray.500">Log</Text>
        <Text as="button" fontSize="xs" color="gray.500" _hover={{ color: "gray.300" }} onClick={clearLog}>Clear</Text>
      </Flex>
      <VStack maxH="120px" overflow="auto" gap={0.5} align="stretch">
        {log.map((entry) => (
          <LogEntry key={entry.id} entry={entry} />
        ))}
      </VStack>
    </Box>
  );
}

function LogEntry({ entry }: { entry: { id: string; traceId: string; status: string; error?: string } }) {
  const [copied, setCopied] = useState(false);
  const canCopy = entry.status === "success";

  return (
    <Flex
      align="center"
      gap={2}
      px={2}
      py={1}
      fontSize="xs"
      rounded="sm"
      cursor={canCopy ? "pointer" : "default"}
      bg={copied ? "green.950/20" : "transparent"}
      _hover={canCopy ? { bg: copied ? "green.950/20" : "bg.subtle" } : undefined}
      transition="background 0.15s"
      onClick={() => {
        if (!canCopy) return;
        void navigator.clipboard.writeText(entry.traceId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Text flexShrink={0}>{entry.status === "pending" ? "⏳" : entry.status === "success" ? "✅" : "❌"}</Text>
      <Text flex={1} truncate fontFamily="mono" color="fg.muted">
        {entry.traceId}
      </Text>
      {canCopy && (
        <Text fontSize="10px" color={copied ? "green.400" : "fg.muted"} flexShrink={0}>
          {copied ? "Copied!" : "Copy ID"}
        </Text>
      )}
      {entry.error && <Text color="red.400" title={entry.error} flexShrink={0}>Failed</Text>}
    </Flex>
  );
}
