import { Box, Flex, Text, IconButton } from "@chakra-ui/react";
import { ChevronUp, ChevronDown, Copy, Trash2, Plus } from "lucide-react";
import { useState } from "react";
import { useTraceStore } from "./traceStore";
import { SPAN_TYPE_ICONS, SPAN_TYPE_COLORS, type SpanConfig, type SpanType } from "./types";

function SpanTreeNode({ span, depth }: { span: SpanConfig; depth: number }) {
  const selectedSpanId = useTraceStore((s) => s.selectedSpanId);
  const selectSpan = useTraceStore((s) => s.selectSpan);
  const removeSpan = useTraceStore((s) => s.removeSpan);
  const duplicateSpan = useTraceStore((s) => s.duplicateSpan);
  const moveSpan = useTraceStore((s) => s.moveSpan);
  const isSelected = selectedSpanId === span.id;

  return (
    <>
      <Flex
        align="center" gap={1.5} px={2} py={1} pl={`${depth * 16 + 8}px`}
        rounded="md" cursor="pointer" fontSize="xs"
        bg={isSelected ? "orange.500/10" : "transparent"}
        color={isSelected ? "orange.400" : "fg.default"}
        _hover={{ bg: isSelected ? "orange.500/10" : "bg.subtle" }}
        onClick={() => selectSpan(span.id)} role="group"
      >
        <Text as="span" flexShrink={0} fontSize="sm">{SPAN_TYPE_ICONS[span.type]}</Text>
        <Text flex={1} truncate fontWeight="medium">{span.name}</Text>
        <Text flexShrink={0} fontSize="10px" textTransform="uppercase" color={SPAN_TYPE_COLORS[span.type]}>{span.type}</Text>
        {span.status === "error" && <Text color="red.400" fontWeight="bold">!</Text>}
        <Flex gap={0} display="none" _groupHover={{ display: "flex" }}>
          <IconButton aria-label="Up" size="2xs" variant="ghost" color="fg.muted" onClick={(e) => { e.stopPropagation(); moveSpan(span.id, "up"); }}><ChevronUp size={12} /></IconButton>
          <IconButton aria-label="Down" size="2xs" variant="ghost" color="fg.muted" onClick={(e) => { e.stopPropagation(); moveSpan(span.id, "down"); }}><ChevronDown size={12} /></IconButton>
          <IconButton aria-label="Copy" size="2xs" variant="ghost" color="fg.muted" onClick={(e) => { e.stopPropagation(); duplicateSpan(span.id); }}><Copy size={12} /></IconButton>
          <IconButton aria-label="Delete" size="2xs" variant="ghost" color="fg.muted" _hover={{ color: "red.400" }} onClick={(e) => { e.stopPropagation(); removeSpan(span.id); }}><Trash2 size={12} /></IconButton>
        </Flex>
      </Flex>
      {span.children.map((child) => <SpanTreeNode key={child.id} span={child} depth={depth + 1} />)}
    </>
  );
}

const COMMON_TYPES: SpanType[] = ["llm", "agent", "tool", "rag", "chain", "prompt", "guardrail", "span"];

function AddSpanMenu({ parentId }: { parentId: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const addSpan = useTraceStore((s) => s.addSpan);

  return (
    <Box position="relative" mt={1}>
      <Flex as="button" w="full" align="center" justify="center" gap={1} rounded="md" border="1px dashed" borderColor="border" px={2} py={1.5} fontSize="xs" color="fg.muted" _hover={{ borderColor: "border.emphasized", color: "fg.default" }} onClick={() => setIsOpen(!isOpen)}>
        <Plus size={12} /> Add Span
      </Flex>
      {isOpen && (
        <>
          <Box position="fixed" inset={0} zIndex={10} onClick={() => setIsOpen(false)} />
          <Box position="absolute" left={0} zIndex={20} mt={1} w="full" rounded="lg" border="1px solid" borderColor="border" bg="bg.panel" p={1} shadow="xl">
            {COMMON_TYPES.map((type) => (
              <Flex key={type} as="button" w="full" align="center" gap={2} rounded="md" px={2} py={1.5} fontSize="xs" color="fg.default" _hover={{ bg: "bg.subtle" }} onClick={() => { addSpan(parentId, type); setIsOpen(false); }}>
                <Text as="span">{SPAN_TYPE_ICONS[type]}</Text>
                <Text textTransform="capitalize">{type}</Text>
              </Flex>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}

export function SpanTreePanel() {
  const spans = useTraceStore((s) => s.trace.spans);
  return (
    <Box p={3}>
      <Text fontSize="xs" fontWeight="medium" textTransform="uppercase" letterSpacing="wider" color="fg.muted" mb={2}>Spans</Text>
      <Flex direction="column" gap={0.5}>
        {spans.map((span) => <SpanTreeNode key={span.id} span={span} depth={0} />)}
      </Flex>
      <AddSpanMenu parentId={null} />
    </Box>
  );
}
