import { Box, Flex, Text, Input, Textarea, Button } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { useTraceStore } from "../traceStore";
import { LLM_MODELS } from "../models";
import type { SpanConfig, LLMConfig, ChatMessage } from "../types";

const ROLE_COLORS: Record<string, string> = {
  system: "purple.500", user: "green.400", assistant: "blue.400", tool: "yellow.400",
};

export function LLMSpanEditor({ span }: { span: SpanConfig }) {
  const updateSpan = useTraceStore((s) => s.updateSpan);
  const llm = span.llm ?? {};

  function updateLLM(partial: Partial<LLMConfig>) {
    updateSpan(span.id, { llm: { ...llm, ...partial } });
  }

  const messages = llm.messages ?? [];

  function updateMessage(index: number, partial: Partial<ChatMessage>) {
    const updated = messages.map((m, i) => (i === index ? { ...m, ...partial } : m));
    updateLLM({ messages: updated });
  }

  return (
    <Box rounded="lg" border="1px solid" borderColor="blue.500/20" bg="blue.500/5" p={4}>
      <Text fontSize="sm" fontWeight="semibold" color="blue.400" mb={3}>LLM Configuration</Text>

      <Flex gap={3} wrap="wrap" mb={3}>
        <Box flex={1} minW="140px">
          <Text fontSize="xs" color="fg.subtle" mb={1}>Model</Text>
          <Input size="sm" value={llm.requestModel ?? ""} onChange={(e) => updateLLM({ requestModel: e.target.value })} placeholder="gpt-4o" list="llm-models" />
          <datalist id="llm-models">
            {LLM_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </datalist>
        </Box>
        <Box w="80px">
          <Text fontSize="xs" color="fg.subtle" mb={1}>Temp</Text>
          <Input size="sm" type="number" value={llm.temperature ?? 0.7} onChange={(e) => updateLLM({ temperature: parseFloat(e.target.value) })} step={0.1} min={0} max={2} />
        </Box>
      </Flex>

      <Text fontSize="xs" fontWeight="medium" color="fg.subtle" mb={1}>Messages</Text>
      <Flex direction="column" gap={2} mb={2}>
        {messages.map((msg, i) => (
          <Flex key={i} gap={2} rounded="md" border="1px solid" borderColor="border" borderLeftWidth="2px" borderLeftColor={ROLE_COLORS[msg.role] ?? "gray.500"} bg="bg.subtle" p={2}>
            <select value={msg.role} onChange={(e) => updateMessage(i, { role: e.target.value as ChatMessage["role"] })} style={{ width: "90px", flexShrink: 0, background: "var(--chakra-colors-bg-subtle)", color: "var(--chakra-colors-fg-default)", border: "1px solid var(--chakra-colors-border)", borderRadius: "4px", padding: "2px 6px", fontSize: "12px" }}>
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
              <option value="tool">tool</option>
            </select>
            <Textarea flex={1} size="sm" fontSize="xs" value={msg.content} onChange={(e) => updateMessage(i, { content: e.target.value })} rows={2} resize="vertical" placeholder="Message content..." />
            <Button size="xs" variant="ghost" color="fg.muted" _hover={{ color: "red.400" }} onClick={() => updateLLM({ messages: messages.filter((_, j) => j !== i) })} alignSelf="flex-start">
              <Trash2 size={12} />
            </Button>
          </Flex>
        ))}
        <Button size="xs" variant="outline" onClick={() => updateLLM({ messages: [...messages, { role: "user", content: "" }] })}>
          <Plus size={12} /> Add Message
        </Button>
      </Flex>

      <Text fontSize="xs" fontWeight="medium" color="fg.subtle" mb={1}>Metrics</Text>
      <Flex gap={3}>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>Prompt Tokens</Text>
          <Input size="sm" type="number" value={llm.metrics?.promptTokens ?? ""} onChange={(e) => updateLLM({ metrics: { ...llm.metrics, promptTokens: parseInt(e.target.value) || undefined } })} placeholder="0" />
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>Completion Tokens</Text>
          <Input size="sm" type="number" value={llm.metrics?.completionTokens ?? ""} onChange={(e) => updateLLM({ metrics: { ...llm.metrics, completionTokens: parseInt(e.target.value) || undefined } })} placeholder="0" />
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>Cost ($)</Text>
          <Input size="sm" type="number" value={llm.metrics?.cost ?? ""} onChange={(e) => updateLLM({ metrics: { ...llm.metrics, cost: parseFloat(e.target.value) || undefined } })} step={0.0001} placeholder="0.00" />
        </Box>
      </Flex>
    </Box>
  );
}
