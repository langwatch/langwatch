import { Badge, Box, Button, Flex, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";
import { Play } from "lucide-react";
import { useState } from "react";

import { useExecutionStore } from "../../behavior/execution.store.ts";
import { getFoundryExecutor } from "../../behavior/trace-executor.ts";
import { useTraceStore } from "../../behavior/trace.store.ts";
import { useTargetProjectKey } from "../../behavior/use-target-project-key.ts";

/** The mark each run outcome shows in the log; anything else reads as failed. */
const LOG_STATUS_LABELS: Record<string, string> = {
  pending: "Sending",
  success: "Sent",
};

export function ExecutionControls({ compact = false }: { compact?: boolean }) {
  const {
    batchCount,
    staggerMs,
    running,
    setBatchCount,
    setStaggerMs,
    setRunning,
    addLogEntry,
    updateLogEntry,
  } = useExecutionStore();
  const trace = useTraceStore((s) => s.trace);
  const { project, mintApiKey } = useTargetProjectKey();

  async function handleSend() {
    if (running || !project) return;
    const apiKey = await mintApiKey();
    if (!apiKey) return;
    setRunning(true);
    const executor = getFoundryExecutor({
      apiKey,
      endpoint: window.location.origin,
      projectId: project?.id,
      resourceAttributes: trace.resourceAttributes,
    });
    try {
      for (let i = 0; i < batchCount; i++) {
        const logId = `log-${nowInstant().epochMilliseconds}-${i}`;
        addLogEntry({
          id: logId,
          traceId: logId,
          timestamp: nowInstant().epochMilliseconds,
          status: "pending",
        });
        try {
          const traceId = await executor.executeTrace(trace);
          updateLogEntry(logId, { status: "success", traceId });
        } catch (err) {
          updateLogEntry(logId, {
            status: "error",
            error: err instanceof Error ? err.message : "Send failed",
          });
        }
        if (staggerMs > 0 && i < batchCount - 1) await new Promise((r) => setTimeout(r, staggerMs));
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <Box p={4}>
      <Text
        fontSize="xs"
        fontWeight="medium"
        textTransform="none"
        letterSpacing="normal"
        color="fg.muted"
        mb={2}
      >
        Execution
      </Text>
      <Flex gap={2} mb={2}>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.subtle" mb={1}>
            Trace count
          </Text>
          <Input
            size="sm"
            type="number"
            aria-label="Trace count"
            value={batchCount}
            onChange={(e) => setBatchCount(parseInt(e.target.value) || 1)}
            min={1}
            max={100}
          />
        </Box>
        {!compact && (
          <Box flex={1}>
            <Text fontSize="xs" color="fg.subtle" mb={1}>
              Stagger (ms)
            </Text>
            <Input
              size="sm"
              type="number"
              aria-label="Stagger in milliseconds"
              value={staggerMs}
              onChange={(e) => setStaggerMs(parseInt(e.target.value) || 0)}
              min={0}
              step={100}
            />
          </Box>
        )}
      </Flex>
      <Button
        w="full"
        size="sm"
        colorPalette="accent"
        onClick={handleSend}
        disabled={running || !project}
        loading={running}
        loadingText="Sending..."
      >
        <Play size={14} /> Send traces
      </Button>
      {!project && (
        <Text fontSize="xs" color="fg.muted" mt={1}>
          Select a target project above
        </Text>
      )}
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
        <Text fontSize="xs" color="fg.muted">
          Log
        </Text>
        <Text
          as="button"
          fontSize="xs"
          color="fg.muted"
          _hover={{ color: "fg.default" }}
          onClick={clearLog}
        >
          Clear
        </Text>
      </Flex>
      <VStack maxH="120px" overflow="auto" gap={0.5} align="stretch">
        {log.map((entry) => (
          <LogEntry key={entry.id} entry={entry} />
        ))}
      </VStack>
    </Box>
  );
}

function LogEntry({
  entry,
}: {
  entry: { id: string; traceId: string; status: string; error?: string };
}) {
  const [copied, setCopied] = useState(false);
  const canCopy = entry.status === "success";
  const palettes: Record<string, string> = { success: "green", pending: "gray" };
  const statusPalette = palettes[entry.status] ?? "red";

  return (
    <Flex
      align="center"
      gap={2}
      px={2}
      py={1}
      fontSize="xs"
      rounded="sm"
      cursor={canCopy ? "pointer" : "default"}
      bg={copied ? "green.subtle" : "transparent"}
      _hover={canCopy ? { bg: copied ? "green.subtle" : "bg.subtle" } : undefined}
      transition="background 0.15s"
      onClick={() => {
        if (!canCopy) return;
        void navigator.clipboard.writeText(entry.traceId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Badge colorPalette={statusPalette}>{LOG_STATUS_LABELS[entry.status] ?? "Failed"}</Badge>
      <Text flex={1} truncate fontFamily="mono" color="fg.muted">
        {entry.traceId}
      </Text>
      {canCopy && (
        <Text fontSize="10px" color={copied ? "green.fg" : "fg.muted"} flexShrink={0}>
          {copied ? "Copied!" : "Copy ID"}
        </Text>
      )}
      {entry.error && (
        <Text color="fg.error" title={entry.error} flexShrink={0}>
          Failed
        </Text>
      )}
    </Flex>
  );
}
