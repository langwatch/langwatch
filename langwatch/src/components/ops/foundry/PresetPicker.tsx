import { useState } from "react";
import { Box, Button, Flex, Text, Badge } from "@chakra-ui/react";
import { ChevronDown, Shuffle } from "lucide-react";
import { useTraceStore } from "./traceStore";
import { usePresetStore } from "./presetStore";
import { useFoundryProjectStore } from "./foundryProjectStore";
import { shortId } from "./types";
import type { SpanConfig, TraceConfig } from "./types";
import { api } from "~/utils/api";

function countSpans(spans: SpanConfig[]): number {
  return spans.reduce((acc, s) => acc + 1 + countSpans(s.children), 0);
}

function collectSpans(spans: SpanConfig[], out: SpanConfig[]) {
  for (const s of spans) {
    out.push(structuredClone({ ...s, children: [] }));
    collectSpans(s.children, out);
  }
}

function reassignIds(span: SpanConfig) {
  span.id = shortId();
  for (const child of span.children) {
    reassignIds(child);
  }
}

function injectRealPrompts(
  config: TraceConfig,
  prompts: Array<{ id: string; handle: string | null; versionId: string; version: number }>
) {
  const promptSpans: SpanConfig[] = [];
  function collect(spans: SpanConfig[]) {
    for (const s of spans) {
      if (s.prompt) promptSpans.push(s);
      collect(s.children);
    }
  }
  collect(config.spans);

  for (let i = 0; i < promptSpans.length; i++) {
    const real = prompts[i % prompts.length]!;
    const s = promptSpans[i]!;
    s.prompt = {
      ...s.prompt,
      promptId: real.handle ?? real.id,
      // The trace-summary projection only registers prompts in the
      // canonical `handle:version` shorthand. Always include the numeric
      // version so the executor can synthesize that form on emit and
      // chips light up on the resulting trace.
      version: real.version,
      versionId: real.versionId,
    };
    s.name = `prompt:${real.handle ?? real.id}`;
  }
}

export function PresetPicker() {
  const [isOpen, setIsOpen] = useState(false);
  const setTrace = useTraceStore((s) => s.setTrace);
  const { builtIn, userPresets } = usePresetStore();
  const allPresets = [...builtIn, ...userPresets];
  const selectedProjectId = useFoundryProjectStore((s) => s.selectedProjectId);
  const prompts = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  function loadPreset(id: string) {
    const preset = allPresets.find((p) => p.id === id);
    if (!preset) return;

    const config = structuredClone(preset.config);

    if (id === "prompt-heavy" && prompts.data && prompts.data.length > 0) {
      injectRealPrompts(config, prompts.data);
    }

    setTrace(config);
    setIsOpen(false);
  }

  function loadMashup() {
    const allSpans: SpanConfig[] = [];
    for (const preset of allPresets) {
      collectSpans(preset.config.spans, allSpans);
    }

    // Shuffle and pick a random subset
    for (let i = allSpans.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allSpans[i], allSpans[j]] = [allSpans[j]!, allSpans[i]!];
    }

    const count = Math.min(
      allSpans.length,
      8 + Math.floor(Math.random() * 8)
    );
    const picked = allSpans.slice(0, count);

    // Reassign IDs and lay out sequentially
    let offsetMs = 0;
    for (const s of picked) {
      reassignIds(s);
      s.offsetMs = offsetMs;
      offsetMs += s.durationMs + 50;
    }

    const mashup: TraceConfig = {
      id: shortId(),
      name: "Mashup",
      resourceAttributes: { "service.name": "mashup" },
      metadata: { labels: ["mashup"] },
      spans: picked,
    };
    setTrace(mashup);
    setIsOpen(false);
  }

  return (
    <Box position="relative">
      <Button size="xs" variant="outline" onClick={() => setIsOpen(!isOpen)}>
        Load Preset <ChevronDown size={12} />
      </Button>
      {isOpen && (
        <>
          <Box position="fixed" inset={0} zIndex={40} onClick={() => setIsOpen(false)} />
          <Box
            position="absolute"
            right={0}
            zIndex={50}
            mt={1}
            w="360px"
            maxH="400px"
            overflow="auto"
            rounded="lg"
            border="1px solid"
            borderColor="border"
            bg="bg.panel"
            shadow="xl"
            p={1}
          >
            <Flex px={2} py={1.5}>
              <Button
                size="xs"
                variant="outline"
                colorPalette="purple"
                w="full"
                onClick={loadMashup}
              >
                <Shuffle size={12} />
                Mashup (random spans from all presets)
              </Button>
            </Flex>
            <Text fontSize="xs" fontWeight="medium" color="fg.muted" px={2} py={1}>
              Built-in Presets
            </Text>
            {builtIn.map((preset) => (
              <Flex
                key={preset.id}
                as="button"
                w="full"
                align="flex-start"
                direction="column"
                gap={0.5}
                rounded="md"
                px={3}
                py={2}
                textAlign="left"
                _hover={{ bg: "bg.subtle" }}
                onClick={() => loadPreset(preset.id)}
              >
                <Flex w="full" justify="space-between" align="center">
                  <Text fontSize="sm" fontWeight="medium" color="fg.default">
                    {preset.name}
                  </Text>
                  <Text fontSize="10px" color="fg.muted">
                    {countSpans(preset.config.spans)} spans
                  </Text>
                </Flex>
                <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                  {preset.description}
                </Text>
              </Flex>
            ))}
            {userPresets.length > 0 && (
              <>
                <Text fontSize="xs" fontWeight="medium" color="fg.muted" px={2} py={1} mt={1}>
                  Your Presets
                </Text>
                {userPresets.map((preset) => (
                  <Flex
                    key={preset.id}
                    as="button"
                    w="full"
                    align="flex-start"
                    direction="column"
                    gap={0.5}
                    rounded="md"
                    px={3}
                    py={2}
                    textAlign="left"
                    _hover={{ bg: "bg.subtle" }}
                    onClick={() => loadPreset(preset.id)}
                  >
                    <Flex w="full" justify="space-between" align="center">
                      <Text fontSize="sm" fontWeight="medium" color="fg.default">
                        {preset.name}
                      </Text>
                      <Badge colorPalette="purple" size="sm">Custom</Badge>
                    </Flex>
                    <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                      {preset.description}
                    </Text>
                  </Flex>
                ))}
              </>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
