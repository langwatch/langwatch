import { Menu } from "@langwatch/design-system/menu";
import { Badge, Box, Button, Flex, IconButton, Text } from "@langwatch/design-system/primitives";
import { ChevronDown, ChevronUp, Copy, MoreHorizontal, Plus, Trash2, Workflow } from "lucide-react";

import { useTraceStore } from "../../behavior/trace.store.ts";
import type { SpanConfig, SpanType } from "../../model/foundry-types.ts";

function SpanTreeNode({ span, depth }: { span: SpanConfig; depth: number }) {
  const selectedSpanId = useTraceStore((s) => s.selectedSpanId);
  const selectSpan = useTraceStore((s) => s.selectSpan);
  const removeSpan = useTraceStore((s) => s.removeSpan);
  const duplicateSpan = useTraceStore((s) => s.duplicateSpan);
  const moveSpan = useTraceStore((s) => s.moveSpan);
  const isSelected = selectedSpanId === span.id;

  return (
    <>
      <Flex align="center" gap={1} pl={`${Math.min(depth, 6) * 12}px`}>
        <Button
          variant="ghost"
          size="sm"
          flex={1}
          minWidth={0}
          justifyContent="start"
          aria-pressed={isSelected}
          bg={isSelected ? "accent.subtle" : "transparent"}
          color={isSelected ? "accent.fg" : "fg.default"}
          onClick={() => selectSpan(span.id)}
        >
          <Workflow size={16} />
          <Text flex={1} truncate textAlign="left">
            {span.name}
          </Text>
          <Badge variant="subtle" colorPalette={span.status === "error" ? "red" : "gray"}>
            {span.status === "error" ? "Error" : span.type}
          </Badge>
        </Button>
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton aria-label={`Actions for ${span.name}`} size="sm" variant="ghost">
              <MoreHorizontal size={16} />
            </IconButton>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="up" onClick={() => moveSpan(span.id, "up")}>
              <ChevronUp size={16} />
              Move up
            </Menu.Item>
            <Menu.Item value="down" onClick={() => moveSpan(span.id, "down")}>
              <ChevronDown size={16} />
              Move down
            </Menu.Item>
            <Menu.Item value="copy" onClick={() => duplicateSpan(span.id)}>
              <Copy size={16} />
              Duplicate
            </Menu.Item>
            <Menu.Item value="delete" color="fg.error" onClick={() => removeSpan(span.id)}>
              <Trash2 size={16} />
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </Flex>
      {span.children.map((child) => (
        <SpanTreeNode key={child.id} span={child} depth={depth + 1} />
      ))}
    </>
  );
}

const COMMON_TYPES: SpanType[] = [
  "llm",
  "agent",
  "tool",
  "rag",
  "chain",
  "prompt",
  "guardrail",
  "span",
];

export function SpanTreePanel() {
  const spans = useTraceStore((s) => s.trace.spans);
  const addSpan = useTraceStore((s) => s.addSpan);

  return (
    <Box p={4}>
      <Flex align="center" justify="space-between" mb={3}>
        <Text fontSize="sm" fontWeight="medium">
          Spans
        </Text>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="sm" variant="outline">
              <Plus size={16} />
              Add span
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            {COMMON_TYPES.map((type) => (
              <Menu.Item key={type} value={type} onClick={() => addSpan(null, type)}>
                <Workflow size={16} />
                {type === "llm" || type === "rag" ? type.toUpperCase() : type}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      </Flex>
      <Flex direction="column" gap={1}>
        {spans.map((span) => (
          <SpanTreeNode key={span.id} span={span} depth={0} />
        ))}
        {spans.length === 0 && (
          <Text fontSize="sm" color="fg.muted">
            Add a span to build your trace.
          </Text>
        )}
      </Flex>
    </Box>
  );
}
