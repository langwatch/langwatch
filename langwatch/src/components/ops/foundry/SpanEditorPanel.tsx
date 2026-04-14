import { Box, Flex, Text, Input, Textarea, Button, HStack, VStack, Portal, createListCollection, Select } from "@chakra-ui/react";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useTraceStore } from "./traceStore";
import { LLMSpanEditor } from "./span-editors/LLMSpanEditor";
import { RAGSpanEditor } from "./span-editors/RAGSpanEditor";
import { PromptSpanEditor } from "./span-editors/PromptSpanEditor";
import { AttributeEditor } from "./span-editors/AttributeEditor";
import { SPAN_TYPES, SPAN_TYPE_ICONS, type SpanConfig, type SpanType } from "./types";

function findSpan(spans: SpanConfig[], id: string): SpanConfig | undefined {
  for (const span of spans) {
    if (span.id === id) return span;
    const found = findSpan(span.children, id);
    if (found) return found;
  }
  return undefined;
}

const spanTypeCollection = createListCollection({ items: SPAN_TYPES.map((t) => ({ label: `${SPAN_TYPE_ICONS[t]} ${t}`, value: t })) });
const statusCollection = createListCollection({ items: [{ label: "OK", value: "ok" }, { label: "Error", value: "error" }, { label: "Unset", value: "unset" }] });

export function SpanEditorPanel() {
  const selectedSpanId = useTraceStore((s) => s.selectedSpanId);
  const spans = useTraceStore((s) => s.trace.spans);
  const updateSpan = useTraceStore((s) => s.updateSpan);
  const indentSpan = useTraceStore((s) => s.indentSpan);
  const outdentSpan = useTraceStore((s) => s.outdentSpan);

  if (!selectedSpanId) return null;
  const span = findSpan(spans, selectedSpanId);
  if (!span) return null;

  return (
    <VStack align="stretch" gap={4} p={5} minW={0} overflow="hidden">
      <Flex align="center" justify="space-between">
        <Text fontSize="lg" fontWeight="semibold">{span.name}</Text>
        <HStack gap={1}>
          <Button size="xs" variant="outline" onClick={() => indentSpan(span.id)}><ArrowRight size={14} /></Button>
          <Button size="xs" variant="outline" onClick={() => outdentSpan(span.id)}><ArrowLeft size={14} /></Button>
        </HStack>
      </Flex>

      <Flex gap={3} wrap="wrap">
        <Box flex="1" minW="140px">
          <Text fontSize="xs" color="gray.400" mb={1}>Name</Text>
          <Input size="sm" value={span.name} onChange={(e) => updateSpan(span.id, { name: e.target.value })} />
        </Box>
        <Box flex="1" minW="140px">
          <Text fontSize="xs" color="gray.400" mb={1}>Type</Text>
          <Select.Root size="sm" collection={spanTypeCollection} value={[span.type]} onValueChange={(e) => updateSpan(span.id, { type: e.value[0] as SpanType })}>
            <Select.Trigger><Select.ValueText /></Select.Trigger>
            <Portal><Select.Positioner><Select.Content>
              {SPAN_TYPES.map((t) => <Select.Item key={t} item={t}>{SPAN_TYPE_ICONS[t]} {t}</Select.Item>)}
            </Select.Content></Select.Positioner></Portal>
          </Select.Root>
        </Box>
      </Flex>

      <Flex gap={3} wrap="wrap">
        <Box flex="1" minW="100px">
          <Text fontSize="xs" color="gray.400" mb={1}>Duration (ms)</Text>
          <Input size="sm" type="number" value={span.durationMs} onChange={(e) => updateSpan(span.id, { durationMs: parseInt(e.target.value) || 0 })} min={0} />
        </Box>
        <Box flex="1" minW="100px">
          <Text fontSize="xs" color="gray.400" mb={1}>Offset (ms)</Text>
          <Input size="sm" type="number" value={span.offsetMs} onChange={(e) => updateSpan(span.id, { offsetMs: parseInt(e.target.value) || 0 })} min={0} />
        </Box>
        <Box flex="1" minW="100px">
          <Text fontSize="xs" color="gray.400" mb={1}>Status</Text>
          <Select.Root size="sm" collection={statusCollection} value={[span.status]} onValueChange={(e) => updateSpan(span.id, { status: e.value[0] as "ok" | "error" | "unset" })}>
            <Select.Trigger><Select.ValueText /></Select.Trigger>
            <Portal><Select.Positioner><Select.Content>
              <Select.Item item="ok">OK</Select.Item>
              <Select.Item item="error">Error</Select.Item>
              <Select.Item item="unset">Unset</Select.Item>
            </Select.Content></Select.Positioner></Portal>
          </Select.Root>
        </Box>
      </Flex>

      {span.status === "error" && (
        <Box rounded="lg" border="1px solid" borderColor="red.900/50" bg="red.950/20" p={3}>
          <Text fontSize="xs" fontWeight="medium" color="red.400" mb={1}>Exception</Text>
          <Input size="sm" value={span.exception?.message ?? ""} onChange={(e) => updateSpan(span.id, { exception: { ...span.exception, message: e.target.value } })} placeholder="Error message" mb={2} />
          <Textarea size="sm" value={span.exception?.stackTrace ?? ""} onChange={(e) => updateSpan(span.id, { exception: { message: span.exception?.message ?? "", stackTrace: e.target.value || undefined } })} placeholder="Stack trace" rows={3} fontFamily="mono" fontSize="xs" />
        </Box>
      )}

      <Flex gap={3}>
        <Box flex={1}>
          <Text fontSize="xs" color="gray.400" mb={1}>Input</Text>
          <Textarea size="sm" fontSize="xs" rows={3} placeholder="Span input..."
            value={span.input?.type === "text" ? (span.input.value as string) : span.input ? JSON.stringify(span.input.value, null, 2) : ""}
            onChange={(e) => updateSpan(span.id, { input: e.target.value ? { type: "text", value: e.target.value } : undefined })} />
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="gray.400" mb={1}>Output</Text>
          <Textarea size="sm" fontSize="xs" rows={3} placeholder="Span output..."
            value={span.output?.type === "text" ? (span.output.value as string) : span.output ? JSON.stringify(span.output.value, null, 2) : ""}
            onChange={(e) => updateSpan(span.id, { output: e.target.value ? { type: "text", value: e.target.value } : undefined })} />
        </Box>
      </Flex>

      {span.type === "llm" && <LLMSpanEditor span={span} />}
      {span.type === "rag" && <RAGSpanEditor span={span} />}
      {span.type === "prompt" && <PromptSpanEditor span={span} />}

      <Box>
        <Text fontSize="xs" fontWeight="medium" textTransform="uppercase" letterSpacing="wider" color="gray.500" mb={1}>Custom Attributes</Text>
        <AttributeEditor attributes={span.attributes} onChange={(attributes) => updateSpan(span.id, { attributes })} />
      </Box>
    </VStack>
  );
}
