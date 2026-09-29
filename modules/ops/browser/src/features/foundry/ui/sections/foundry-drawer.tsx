import { Box, Button, Flex, HStack, Input, Spacer, Text, VStack } from "@chakra-ui/react";
import type { UiFoundryDrawerProps } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { nowInstant } from "@langwatch/time";
import { Play, RotateCcw } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

import { useExecutionStore } from "../../behavior/execution.store.ts";
import { usePresetStore } from "../../behavior/preset.store.ts";
import { getFoundryExecutor } from "../../behavior/trace-executor.ts";
import { useTraceStore } from "../../behavior/trace.store.ts";
import { useTargetProject } from "../../behavior/use-target-project.ts";
import { type Preset, SPAN_TYPE_ICONS, type SpanConfig } from "../../model/foundry-types.ts";

export function FoundryDrawer({ onClose }: UiFoundryDrawerProps) {
  const project = useTargetProject();
  const apiKey = project?.apiKey;
  const trace = useTraceStore((s) => s.trace);
  const setTrace = useTraceStore((s) => s.setTrace);
  const resetTrace = useTraceStore((s) => s.resetTrace);
  const selectedSpanId = useTraceStore((s) => s.selectedSpanId);
  const selectSpan = useTraceStore((s) => s.selectSpan);
  const updateSpan = useTraceStore((s) => s.updateSpan);
  const { running, setRunning, addLogEntry, updateLogEntry } = useExecutionStore();
  const { builtIn } = usePresetStore();
  const [showPresets, setShowPresets] = useState(!trace.spans.length);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);

  const sendRef = useFoundryShortcuts(resetTrace);

  async function handleSend() {
    if (running || !apiKey) return;
    setRunning(true);
    const logId = `log-${nowInstant().epochMilliseconds}`;
    addLogEntry({
      id: logId,
      traceId: logId,
      timestamp: nowInstant().epochMilliseconds,
      status: "pending",
    });
    const executor = getFoundryExecutor({
      apiKey,
      endpoint: window.location.origin,
      projectId: project?.id,
      resourceAttributes: trace.resourceAttributes,
    });
    try {
      const traceId = await executor.executeTrace(trace);
      updateLogEntry(logId, { status: "success", traceId });
      setLastTraceId(traceId);
    } catch (err) {
      updateLogEntry(logId, {
        status: "error",
        error: err instanceof Error ? err.message : "Failed",
      });
    } finally {
      setRunning(false);
    }
  }

  const spans = trace.spans;
  const selectedSpan = selectedSpanId ? findSpan(spans, selectedSpanId) : null;

  return (
    <Drawer.Root open={true} placement="end" size="md" onOpenChange={() => onClose()}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack width="full">
            <Drawer.Title>The Foundry</Drawer.Title>
            <Spacer />
            <Button size="xs" variant="ghost" onClick={resetTrace}>
              <RotateCcw size={14} />
            </Button>
          </HStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body padding={0}>
          <VStack align="stretch" gap={0} h="full">
            {showPresets ? (
              <PresetPicker
                presets={builtIn.slice(0, 8)}
                onPick={(config) => {
                  setTrace(structuredClone(config));
                  setShowPresets(false);
                }}
              />
            ) : (
              <>
                <Box flex={1} overflow="auto" p={3}>
                  <HStack justify="space-between" mb={2}>
                    <Text
                      fontSize="xs"
                      fontWeight="medium"
                      textTransform="uppercase"
                      color="fg.muted"
                    >
                      Spans ({countSpans(spans)})
                    </Text>
                    <Button size="2xs" variant="ghost" onClick={() => setShowPresets(true)}>
                      Change preset
                    </Button>
                  </HStack>
                  {spans.map((span) => (
                    <CompactSpanNode
                      key={span.id}
                      span={span}
                      depth={0}
                      selectedId={selectedSpanId}
                      onSelect={selectSpan}
                    />
                  ))}

                  {selectedSpan && <SelectedSpanEditor span={selectedSpan} onUpdate={updateSpan} />}
                </Box>

                <Box p={3} borderTop="1px solid" borderColor="border" bg="bg.subtle">
                  <HStack gap={2}>
                    <Button
                      ref={sendRef}
                      flex={1}
                      size="sm"
                      colorPalette="orange"
                      onClick={handleSend}
                      disabled={running || !apiKey}
                      loading={running}
                      loadingText="Sending..."
                    >
                      <Play size={14} /> Send Trace
                    </Button>
                    <Button size="sm" variant="outline" onClick={resetTrace} title="Reset (R)">
                      <RotateCcw size={14} />
                    </Button>
                  </HStack>
                  {lastTraceId && <SentTraceNotice traceId={lastTraceId} />}
                  <Text fontSize="10px" color="fg.muted" mt={1} textAlign="center">
                    ⌘Enter to send · R to reset
                  </Text>
                </Box>
              </>
            )}
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function CompactSpanNode({
  span,
  depth,
  selectedId,
  onSelect,
}: {
  span: SpanConfig;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const isSelected = selectedId === span.id;
  return (
    <>
      <Flex
        align="center"
        gap={1}
        pl={`${depth * 12 + 4}px`}
        pr={1}
        py={0.5}
        rounded="sm"
        cursor="pointer"
        fontSize="xs"
        bg={isSelected ? "orange.500/10" : "transparent"}
        color={isSelected ? "orange.400" : "fg.default"}
        _hover={{ bg: isSelected ? "orange.500/10" : "bg.subtle" }}
        onClick={() => onSelect(span.id)}
      >
        <Text flexShrink={0}>{SPAN_TYPE_ICONS[span.type]}</Text>
        <Text truncate>{span.name}</Text>
        <Text flexShrink={0} fontSize="10px" color="fg.muted">
          {span.durationMs}ms
        </Text>
      </Flex>
      {span.children.map((c) => (
        <CompactSpanNode
          key={c.id}
          span={c}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function findSpan(spans: SpanConfig[], id: string): SpanConfig | undefined {
  for (const s of spans) {
    if (s.id === id) return s;
    const found = findSpan(s.children, id);
    if (found) return found;
  }
  return undefined;
}

function countSpans(spans: SpanConfig[]): number {
  return spans.reduce((n, s) => n + 1 + countSpans(s.children), 0);
}

/** The selected span's editable input: its messages for an LLM span, its text otherwise. */
function SelectedSpanEditor({
  span,
  onUpdate,
}: {
  span: SpanConfig;
  onUpdate: (id: string, partial: Partial<SpanConfig>) => void;
}) {
  return (
    <Box mt={3} p={3} rounded="md" border="1px solid" borderColor="border" bg="bg.subtle">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb={2}>
        {SPAN_TYPE_ICONS[span.type]} {span.name}
      </Text>
      {span.type === "llm" &&
        span.llm?.messages?.map((msg, i) => (
          <Box key={i} mb={1}>
            <Text fontSize="10px" color="fg.muted" mb={0.5}>
              {msg.role}
            </Text>
            <Input
              size="sm"
              fontSize="xs"
              value={msg.content}
              onChange={(e) => {
                const msgs = [...(span.llm?.messages ?? [])];
                msgs[i] = {
                  ...msgs[i]!,
                  content: e.target.value,
                };
                onUpdate(span.id, {
                  llm: { ...span.llm, messages: msgs },
                });
              }}
            />
          </Box>
        ))}
      {span.type !== "llm" && (
        <Input
          size="sm"
          fontSize="xs"
          placeholder="Input..."
          value={span.input?.type === "text" ? (span.input.value as string) : ""}
          onChange={(e) =>
            onUpdate(span.id, {
              input: { type: "text", value: e.target.value },
            })
          }
        />
      )}
    </Box>
  );
}

/** The last sent trace's id, copied on click. */
function SentTraceNotice({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Box
      as="button"
      mt={2}
      w="full"
      rounded="md"
      bg={copied ? "green.950/30" : "bg.emphasized"}
      px={3}
      py={2}
      cursor="pointer"
      transition="background 0.15s"
      _hover={{ bg: copied ? "green.950/30" : "bg.muted" }}
      _active={{ bg: "green.950/40" }}
      onClick={() => {
        void navigator.clipboard.writeText(traceId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Text fontSize="xs" color={copied ? "green.400" : "fg.default"} fontWeight="medium" mb={0.5}>
        {copied ? "Trace ID copied!" : "Trace sent: click to copy ID"}
      </Text>
      <Text fontSize="11px" fontFamily="mono" color="fg.muted" truncate>
        {traceId}
      </Text>
    </Box>
  );
}

/** The built-in presets a new trace starts from. */
function PresetPicker({
  presets,
  onPick,
}: {
  presets: Preset[];
  onPick: (config: Preset["config"]) => void;
}) {
  return (
    <VStack align="stretch" gap={1} p={4} flex={1} overflow="auto">
      <Text fontSize="sm" fontWeight="semibold" mb={2}>
        Pick a preset to start
      </Text>
      {presets.map((preset) => (
        <Flex
          key={preset.id}
          as="button"
          align="center"
          justify="space-between"
          rounded="md"
          border="1px solid"
          borderColor="border"
          px={3}
          py={2}
          _hover={{ bg: "bg.subtle" }}
          onClick={() => onPick(preset.config)}
        >
          <VStack align="start" gap={0}>
            <Text fontSize="sm" fontWeight="medium">
              {preset.name}
            </Text>
            <Text fontSize="xs" color="fg.muted" lineClamp={1}>
              {preset.description}
            </Text>
          </VStack>
          <Text fontSize="xs" color="fg.muted">
            {countSpans(preset.config.spans)} spans
          </Text>
        </Flex>
      ))}
    </VStack>
  );
}

/** ⌘Enter sends the trace, R resets it, except while typing in a field. */
function useFoundryShortcuts(resetTrace: () => void): RefObject<HTMLButtonElement | null> {
  const sendRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        sendRef.current?.click();
      }
      if (e.key === "r" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        resetTrace();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [resetTrace]);

  return sendRef;
}
