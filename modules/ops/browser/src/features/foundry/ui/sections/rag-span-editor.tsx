import { Card } from "@langwatch/design-system/card";
import { Button, Flex, Input, Text, Textarea } from "@langwatch/design-system/primitives";
import { Plus, Trash2 } from "lucide-react";

import { useTraceStore } from "../../behavior/trace.store.ts";
import type { RAGContext, SpanConfig } from "../../model/foundry-types.ts";

export function RAGSpanEditor({ span }: { span: SpanConfig }) {
  const updateSpan = useTraceStore((s) => s.updateSpan);
  const contexts = span.rag?.contexts ?? [];

  function updateContext(index: number, partial: Partial<RAGContext>) {
    const updated = contexts.map((c, i) => (i === index ? { ...c, ...partial } : c));
    updateSpan(span.id, { rag: { contexts: updated } });
  }

  return (
    <Card variant="nested" tone="teal" padding="md">
      <Text as="h3" fontSize="sm" fontWeight="semibold" color="teal.fg" mb={3}>
        RAG Contexts
      </Text>
      <Flex direction="column" gap={3}>
        {contexts.map((ctx, i) => (
          <Card key={i} variant="nested" tone="neutral" padding="sm">
            <Flex justify="space-between" mb={2}>
              <Text fontSize="xs" fontWeight="medium" color="fg.subtle">
                Context {i + 1}
              </Text>
              <Button
                size="sm"
                variant="ghost"
                color="fg.muted"
                _hover={{ color: "red.fg" }}
                onClick={() =>
                  updateSpan(span.id, {
                    rag: { contexts: contexts.filter((_, j) => j !== i) },
                  })
                }
              >
                <Trash2 size={12} />
              </Button>
            </Flex>
            <Flex gap={2} mb={2}>
              <Input
                size="sm"
                flex={1}
                value={ctx.document_id}
                onChange={(e) => updateContext(i, { document_id: e.target.value })}
                placeholder="Document ID"
              />
              <Input
                size="sm"
                flex={1}
                value={ctx.chunk_id}
                onChange={(e) => updateContext(i, { chunk_id: e.target.value })}
                placeholder="Chunk ID"
              />
            </Flex>
            <Textarea
              size="sm"
              fontSize="xs"
              value={ctx.content}
              onChange={(e) => updateContext(i, { content: e.target.value })}
              placeholder="Retrieved content..."
              rows={3}
            />
          </Card>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            updateSpan(span.id, {
              rag: {
                contexts: [...contexts, { document_id: "", chunk_id: "", content: "" }],
              },
            })
          }
        >
          <Plus size={12} /> Add Context
        </Button>
      </Flex>
    </Card>
  );
}
