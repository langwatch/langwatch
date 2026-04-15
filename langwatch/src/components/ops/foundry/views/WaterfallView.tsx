import { Box, Flex, Text } from "@chakra-ui/react";
import { useTraceStore } from "../traceStore";
import { SPAN_TYPE_ICONS, type SpanConfig } from "../types";

interface FlatSpan {
  span: SpanConfig;
  depth: number;
  absoluteStartMs: number;
  absoluteEndMs: number;
}

function flattenSpans(spans: SpanConfig[], depth: number, parentStartMs: number): FlatSpan[] {
  const result: FlatSpan[] = [];
  for (const span of spans) {
    const absoluteStart = parentStartMs + span.offsetMs;
    result.push({ span, depth, absoluteStartMs: absoluteStart, absoluteEndMs: absoluteStart + span.durationMs });
    result.push(...flattenSpans(span.children, depth + 1, absoluteStart));
  }
  return result;
}

const TYPE_COLORS: Record<string, string> = {
  llm: "blue.500", agent: "purple.500", tool: "green.500", rag: "teal.500",
  chain: "orange.500", prompt: "yellow.500", guardrail: "red.500", workflow: "blue.600",
  span: "gray.500",
};

export function WaterfallView() {
  const spans = useTraceStore((s) => s.trace.spans);
  const selectedSpanId = useTraceStore((s) => s.selectedSpanId);
  const selectSpan = useTraceStore((s) => s.selectSpan);

  const flat = flattenSpans(spans, 0, 0);
  if (flat.length === 0) return <Flex h="200px" align="center" justify="center" color="fg.muted"><Text>No spans</Text></Flex>;

  const minTime = Math.min(...flat.map((f) => f.absoluteStartMs));
  const maxTime = Math.max(...flat.map((f) => f.absoluteEndMs));
  const totalDuration = maxTime - minTime || 1;

  const ticks = Array.from({ length: 6 }, (_, i) => Math.round(minTime + (totalDuration * i) / 5));

  return (
    <Box p={4}>
      {/* Time axis */}
      <Flex pl="180px" mb={2}>
        <Box position="relative" flex={1} h="16px">
          {ticks.map((tick, i) => (
            <Text
              key={i}
              position="absolute"
              fontSize="10px"
              color="fg.muted"
              transform="translateX(-50%)"
              left={`${((tick - minTime) / totalDuration) * 100}%`}
            >
              {tick}ms
            </Text>
          ))}
        </Box>
      </Flex>

      {/* Rows */}
      <Flex direction="column" gap={0.5}>
        {flat.map((item) => {
          const left = ((item.absoluteStartMs - minTime) / totalDuration) * 100;
          const width = Math.max((item.span.durationMs / totalDuration) * 100, 0.5);
          const isSelected = selectedSpanId === item.span.id;
          const barColor = item.span.status === "error" ? "red.500" : (TYPE_COLORS[item.span.type] ?? "gray.500");

          return (
            <Flex
              key={item.span.id}
              align="center"
              cursor="pointer"
              rounded="sm"
              bg={isSelected ? "orange.500/10" : "transparent"}
              _hover={{ bg: isSelected ? "orange.500/10" : "bg.subtle" }}
              onClick={() => selectSpan(item.span.id)}
            >
              <Flex w="180px" flexShrink={0} align="center" gap={1} pr={2} pl={`${item.depth * 16 + 8}px`} truncate>
                <Text fontSize="xs" flexShrink={0}>{SPAN_TYPE_ICONS[item.span.type]}</Text>
                <Text fontSize="xs" color="fg.default" truncate>{item.span.name}</Text>
              </Flex>
              <Box flex={1} position="relative" h="20px">
                <Box
                  position="absolute"
                  top="3px"
                  h="14px"
                  rounded="sm"
                  bg={barColor}
                  left={`${left}%`}
                  w={`${width}%`}
                  minW="4px"
                  opacity={isSelected ? 1 : 0.8}
                  ring={isSelected ? "1px" : undefined}
                  ringColor={isSelected ? "orange.400" : undefined}
                />
              </Box>
              <Text w="50px" flexShrink={0} textAlign="right" fontSize="10px" color="fg.muted" pr={2}>
                {item.span.durationMs}ms
              </Text>
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );
}
