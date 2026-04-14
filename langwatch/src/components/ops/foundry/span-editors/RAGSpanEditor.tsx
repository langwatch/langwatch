import { Box, Flex, Text, Input, Textarea, Button } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { useTraceStore } from "../traceStore";
import type { SpanConfig, RAGContext } from "../types";

export function RAGSpanEditor({ span }: { span: SpanConfig }) {
  const updateSpan = useTraceStore((s) => s.updateSpan);
  const contexts = span.rag?.contexts ?? [];

  function updateContext(index: number, partial: Partial<RAGContext>) {
    const updated = contexts.map((c, i) => (i === index ? { ...c, ...partial } : c));
    updateSpan(span.id, { rag: { contexts: updated } });
  }

  return (
    <Box rounded="lg" border="1px solid" borderColor="teal.900/30" bg="teal.950/10" p={4}>
      <Text fontSize="sm" fontWeight="semibold" color="teal.400" mb={3}>RAG Contexts</Text>
      <Flex direction="column" gap={3}>
        {contexts.map((ctx, i) => (
          <Box key={i} rounded="md" border="1px solid" borderColor="gray.700" bg="gray.900/50" p={3}>
            <Flex justify="space-between" mb={2}>
              <Text fontSize="xs" fontWeight="medium" color="gray.400">Context {i + 1}</Text>
              <Button size="xs" variant="ghost" color="gray.500" _hover={{ color: "red.400" }}
                onClick={() => updateSpan(span.id, { rag: { contexts: contexts.filter((_, j) => j !== i) } })}>
                <Trash2 size={12} />
              </Button>
            </Flex>
            <Flex gap={2} mb={2}>
              <Input size="sm" flex={1} value={ctx.document_id} onChange={(e) => updateContext(i, { document_id: e.target.value })} placeholder="Document ID" />
              <Input size="sm" flex={1} value={ctx.chunk_id} onChange={(e) => updateContext(i, { chunk_id: e.target.value })} placeholder="Chunk ID" />
            </Flex>
            <Textarea size="sm" fontSize="xs" value={ctx.content} onChange={(e) => updateContext(i, { content: e.target.value })} placeholder="Retrieved content..." rows={3} />
          </Box>
        ))}
        <Button size="xs" variant="outline" onClick={() => updateSpan(span.id, { rag: { contexts: [...contexts, { document_id: "", chunk_id: "", content: "" }] } })}>
          <Plus size={12} /> Add Context
        </Button>
      </Flex>
    </Box>
  );
}
