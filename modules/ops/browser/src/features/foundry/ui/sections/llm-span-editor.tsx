import { Card, type CardTone } from "@langwatch/design-system/card";
import {
  Box,
  Button,
  Flex,
  Input,
  NativeSelect,
  Text,
  Textarea,
} from "@langwatch/design-system/primitives";
import { Plus, Trash2 } from "lucide-react";

import { useTraceStore } from "../../behavior/trace.store.ts";
import { LLM_MODELS } from "../../model/foundry-models.ts";
import type { ChatMessage, LLMConfig, SpanConfig } from "../../model/foundry-types.ts";

const ROLE_TONES: Record<string, CardTone> = {
  system: "purple",
  user: "green",
  assistant: "blue",
  tool: "yellow",
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
    <Card variant="nested" tone="blue" padding="md">
      <Text as="h3" fontSize="sm" fontWeight="semibold" color="blue.fg" mb={3}>
        LLM Configuration
      </Text>

      <Flex gap={3} wrap="wrap" mb={3}>
        <Box flex={1} minW="140px">
          <Text fontSize="xs" color="fg.subtle" mb={1}>
            Model
          </Text>
          <Input
            size="sm"
            value={llm.requestModel ?? ""}
            onChange={(e) => updateLLM({ requestModel: e.target.value })}
            placeholder="gpt-4o"
            list="llm-models"
          />
          <datalist id="llm-models">
            {LLM_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </datalist>
        </Box>
        <Box w="80px">
          <Text fontSize="xs" color="fg.subtle" mb={1}>
            Temp
          </Text>
          <Input
            size="sm"
            type="number"
            value={llm.temperature ?? 0.7}
            onChange={(e) => updateLLM({ temperature: parseFloat(e.target.value) })}
            step={0.1}
            min={0}
            max={2}
          />
        </Box>
      </Flex>

      <Text fontSize="xs" fontWeight="medium" color="fg.subtle" mb={1}>
        Messages
      </Text>
      <Flex direction="column" gap={2} mb={2}>
        {messages.map((msg, i) => (
          <Card key={i} variant="accent-row" tone={ROLE_TONES[msg.role] ?? "neutral"}>
            <Flex gap={2}>
              <NativeSelect.Root width="28" flexShrink={0} size="sm">
                <NativeSelect.Field
                  aria-label={`Message ${i + 1} role`}
                  value={msg.role}
                  onChange={(e) =>
                    updateMessage(i, {
                      role: e.target.value as ChatMessage["role"],
                    })
                  }
                >
                  <option value="system">system</option>
                  <option value="user">user</option>
                  <option value="assistant">assistant</option>
                  <option value="tool">tool</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <Textarea
                flex={1}
                size="sm"
                fontSize="xs"
                value={msg.content}
                onChange={(e) => updateMessage(i, { content: e.target.value })}
                rows={2}
                resize="vertical"
                placeholder="Message content..."
              />
              <Button
                size="sm"
                variant="ghost"
                color="fg.muted"
                _hover={{ color: "red.fg" }}
                onClick={() => updateLLM({ messages: messages.filter((_, j) => j !== i) })}
                alignSelf="flex-start"
              >
                <Trash2 size={12} />
              </Button>
            </Flex>
          </Card>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            updateLLM({
              messages: [...messages, { role: "user", content: "" }],
            })
          }
        >
          <Plus size={12} /> Add Message
        </Button>
      </Flex>

      <Text fontSize="xs" fontWeight="medium" color="fg.subtle" mb={1}>
        Metrics
      </Text>
      <Flex gap={3}>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>
            Prompt Tokens
          </Text>
          <Input
            size="sm"
            type="number"
            value={llm.metrics?.promptTokens ?? ""}
            onChange={(e) =>
              updateLLM({
                metrics: {
                  ...llm.metrics,
                  promptTokens: parseInt(e.target.value) || undefined,
                },
              })
            }
            placeholder="0"
          />
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>
            Completion Tokens
          </Text>
          <Input
            size="sm"
            type="number"
            value={llm.metrics?.completionTokens ?? ""}
            onChange={(e) =>
              updateLLM({
                metrics: {
                  ...llm.metrics,
                  completionTokens: parseInt(e.target.value) || undefined,
                },
              })
            }
            placeholder="0"
          />
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>
            Cost ($)
          </Text>
          <Input
            size="sm"
            type="number"
            value={llm.metrics?.cost ?? ""}
            onChange={(e) =>
              updateLLM({
                metrics: {
                  ...llm.metrics,
                  cost: parseFloat(e.target.value) || undefined,
                },
              })
            }
            step={0.0001}
            placeholder="0.00"
          />
        </Box>
      </Flex>
    </Card>
  );
}
