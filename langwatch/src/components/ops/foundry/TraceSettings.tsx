import { Box, Text, Input, VStack } from "@chakra-ui/react";
import { useTraceStore } from "./traceStore";

export function TraceSettings({ compact = false }: { compact?: boolean }) {
  const trace = useTraceStore((s) => s.trace);
  const updateTrace = useTraceStore((s) => s.updateTrace);

  return (
    <Box p={3}>
      <Text fontSize="xs" fontWeight="medium" textTransform="uppercase" letterSpacing="wider" color="gray.500" mb={2}>
        Trace Settings
      </Text>
      <VStack gap={2} align="stretch">
        <Box>
          <Text fontSize="xs" color="gray.400" mb={1}>service.name</Text>
          <Input size="sm" value={trace.resourceAttributes["service.name"] ?? ""} onChange={(e) => updateTrace({ resourceAttributes: { ...trace.resourceAttributes, "service.name": e.target.value } })} />
        </Box>
        <Box>
          <Text fontSize="xs" color="gray.400" mb={1}>user_id</Text>
          <Input size="sm" value={trace.metadata.userId ?? ""} onChange={(e) => updateTrace({ metadata: { ...trace.metadata, userId: e.target.value || undefined } })} placeholder="optional" />
        </Box>
        {!compact && (
          <>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>thread_id</Text>
              <Input size="sm" value={trace.metadata.threadId ?? ""} onChange={(e) => updateTrace({ metadata: { ...trace.metadata, threadId: e.target.value || undefined } })} placeholder="optional" />
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.400" mb={1}>labels</Text>
              <Input size="sm" value={trace.metadata.labels?.join(", ") ?? ""} onChange={(e) => updateTrace({ metadata: { ...trace.metadata, labels: e.target.value ? e.target.value.split(",").map((l) => l.trim()) : undefined } })} placeholder="e.g. production, v2" />
            </Box>
          </>
        )}
      </VStack>
    </Box>
  );
}
