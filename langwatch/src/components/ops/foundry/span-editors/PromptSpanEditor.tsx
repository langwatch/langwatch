import { Box, Flex, Text, Input, Button } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { useTraceStore } from "../traceStore";
import type { SpanConfig, PromptConfig } from "../types";

export function PromptSpanEditor({ span }: { span: SpanConfig }) {
  const updateSpan = useTraceStore((s) => s.updateSpan);
  const prompt = span.prompt ?? {};

  function updatePrompt(partial: Partial<PromptConfig>) {
    updateSpan(span.id, { prompt: { ...prompt, ...partial } });
  }

  const variables = prompt.variables ?? {};
  const entries = Object.entries(variables);

  return (
    <Box rounded="lg" border="1px solid" borderColor="yellow.500/20" bg="yellow.500/5" p={4}>
      <Text fontSize="sm" fontWeight="semibold" color="yellow.400" mb={3}>Prompt Configuration</Text>
      <Flex gap={3} mb={3}>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.subtle" mb={1}>Prompt ID</Text>
          <Input size="sm" value={prompt.promptId ?? ""} onChange={(e) => updatePrompt({ promptId: e.target.value })} placeholder="e.g. customer-support-v2" />
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.subtle" mb={1}>Version ID</Text>
          <Input size="sm" value={prompt.versionId ?? ""} onChange={(e) => updatePrompt({ versionId: e.target.value })} placeholder="e.g. ver-abc123" />
        </Box>
      </Flex>
      <Text fontSize="xs" fontWeight="medium" color="fg.subtle" mb={1}>Template Variables</Text>
      <Flex direction="column" gap={1}>
        {entries.map(([key, value]) => (
          <Flex key={key} align="center" gap={2}>
            <Input size="sm" w="120px" flexShrink={0} value={key} onChange={(e) => {
              const next = { ...variables }; delete next[key]; next[e.target.value] = value;
              updatePrompt({ variables: next });
            }} placeholder="key" />
            <Input size="sm" flex={1} value={value} onChange={(e) => updatePrompt({ variables: { ...variables, [key]: e.target.value } })} placeholder="value" />
            <Button size="xs" variant="ghost" color="fg.muted" _hover={{ color: "red.400" }}
              onClick={() => { const next = { ...variables }; delete next[key]; updatePrompt({ variables: next }); }}>
              <Trash2 size={12} />
            </Button>
          </Flex>
        ))}
        <Button size="xs" variant="outline" onClick={() => updatePrompt({ variables: { ...variables, [`var_${entries.length + 1}`]: "" } })}>
          <Plus size={12} /> Add Variable
        </Button>
      </Flex>
    </Box>
  );
}
