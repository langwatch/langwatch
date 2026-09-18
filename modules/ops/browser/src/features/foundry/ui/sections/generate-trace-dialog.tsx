import { Box, Button, Flex, Input, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@langwatch/design-system/popover";
import { SimpleSlider } from "@langwatch/design-system/slider";
import { Switch } from "@langwatch/design-system/switch";
import { useFoundryProjectStore } from "../../behavior/foundry-project.store.ts";
import type { GeneratorOptions, PromptRef } from "../../model/trace-generator.ts";
import { generateTrace } from "../../model/trace-generator.ts";
import { useTraceStore } from "../../behavior/trace.store.ts";
import { useFoundryPrompts } from "../../behavior/use-foundry-prompts.ts";

const DEPTH_PRESETS = [
  { label: "Shallow", value: 4 },
  { label: "Medium", value: 8 },
  { label: "Deep", value: 14 },
] as const;

/** What the "use real prompts" toggle says about the project it would sample. */
function describeRealPrompts({
  hasProject,
  useRealPrompts,
  loading,
  promptCount,
}: {
  hasProject: boolean;
  useRealPrompts: boolean;
  loading: boolean;
  promptCount: number;
}): string {
  if (!hasProject) return "Select a project first";
  if (!useRealPrompts) return "Attach real prompt IDs to LLM spans";
  if (loading) return "Loading prompts\u2026";
  if (promptCount === 0) return "No prompts in this project";
  return `Sampling from ${promptCount} prompt${promptCount === 1 ? "" : "s"}`;
}

export function GenerateTraceDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const setTrace = useTraceStore((s) => s.setTrace);
  const selectedProjectId = useFoundryProjectStore((s) => s.selectedProjectId);

  const [targetSpanCount, setTargetSpanCount] = useState(1500);
  const [depthPreset, setDepthPreset] = useState<number>(1); // index into DEPTH_PRESETS
  const [genaiRatio, setGenaiRatio] = useState(0.8);
  const [useRealPrompts, setUseRealPrompts] = useState(false);
  const [includeEvents, setIncludeEvents] = useState(false);

  const promptsQuery = useFoundryPrompts({
    enabled: isOpen && useRealPrompts,
    projectId: selectedProjectId,
  });

  function handleGenerate() {
    const prompts: PromptRef[] | undefined =
      useRealPrompts && promptsQuery.prompts ? promptsQuery.prompts : undefined;

    const options: GeneratorOptions = {
      targetSpanCount,
      maxDepth: DEPTH_PRESETS[depthPreset]!.value,
      genaiRatio,
      prompts,
      includeEvents,
    };
    const trace = generateTrace(options);
    setTrace(trace);
    setIsOpen(false);
  }

  return (
    <PopoverRoot
      open={isOpen}
      onOpenChange={(e) => setIsOpen(e.open)}
      positioning={{ placement: "bottom-end" }}
    >
      <PopoverTrigger asChild>
        <Button size="xs" variant="outline">
          <Sparkles size={14} />
          Generate
        </Button>
      </PopoverTrigger>
      <PopoverContent width="340px">
        <PopoverBody p={4}>
          <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={3}>
            Generate Trace
          </Text>

          <VStack gap={4} align="stretch">
            {/* Span count */}
            <Box>
              <Flex justify="space-between" mb={1}>
                <Text fontSize="xs" color="fg.muted">
                  Target span count
                </Text>
                <Text fontSize="xs" fontFamily="mono" color="fg.default">
                  {targetSpanCount.toLocaleString()}
                </Text>
              </Flex>
              <Input
                size="sm"
                type="number"
                value={targetSpanCount}
                onChange={(e) =>
                  setTargetSpanCount(Math.max(10, Math.min(5000, parseInt(e.target.value) || 100)))
                }
                min={10}
                max={5000}
                step={100}
              />
              <Flex gap={1} mt={1}>
                {[500, 1500, 2500, 3000].map((v) => (
                  <Button
                    key={v}
                    size="xs"
                    variant={targetSpanCount === v ? "solid" : "ghost"}
                    colorPalette={targetSpanCount === v ? "orange" : undefined}
                    onClick={() => setTargetSpanCount(v)}
                    flex={1}
                    textStyle="2xs"
                  >
                    {v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v}
                  </Button>
                ))}
              </Flex>
            </Box>

            {/* Nesting depth */}
            <Box>
              <Text fontSize="xs" color="fg.muted" mb={1}>
                Nesting depth
              </Text>
              <Flex gap={1}>
                {DEPTH_PRESETS.map((preset, i) => (
                  <Button
                    key={preset.label}
                    size="xs"
                    variant={depthPreset === i ? "solid" : "outline"}
                    colorPalette={depthPreset === i ? "orange" : undefined}
                    onClick={() => setDepthPreset(i)}
                    flex={1}
                  >
                    {preset.label}
                  </Button>
                ))}
              </Flex>
              <Text textStyle="2xs" color="fg.subtle" mt={1}>
                Max {DEPTH_PRESETS[depthPreset]!.value} levels deep
              </Text>
            </Box>

            {/* GenAI ratio */}
            <Box>
              <Flex justify="space-between" mb={1}>
                <Text fontSize="xs" color="fg.muted">
                  GenAI span ratio
                </Text>
                <Text fontSize="xs" fontFamily="mono" color="fg.default">
                  {Math.round(genaiRatio * 100)}%
                </Text>
              </Flex>
              <SimpleSlider
                size="sm"
                min={20}
                max={100}
                step={5}
                value={[genaiRatio * 100]}
                onValueChange={(d) => setGenaiRatio((d.value[0] ?? 80) / 100)}
              />
              <Flex justify="space-between" mt={0.5}>
                <Text textStyle="2xs" color="fg.subtle">
                  Mixed infra
                </Text>
                <Text textStyle="2xs" color="fg.subtle">
                  All GenAI
                </Text>
              </Flex>
            </Box>

            {/* OTel events toggle */}
            <Box>
              <Flex align="center" justify="space-between" gap={2}>
                <Box flex={1} minW={0}>
                  <Text fontSize="xs" color="fg.muted">
                    OTel span events
                  </Text>
                  <Text textStyle="2xs" color="fg.subtle">
                    Attach gen_ai.* messages, choices, exceptions
                  </Text>
                </Box>
                <Switch
                  size="sm"
                  colorPalette="orange"
                  checked={includeEvents}
                  onCheckedChange={(d) => setIncludeEvents(d.checked)}
                />
              </Flex>
            </Box>

            {/* Real prompts toggle */}
            <Box>
              <Flex align="center" justify="space-between" gap={2}>
                <Box flex={1} minW={0}>
                  <Text fontSize="xs" color="fg.muted">
                    Use real prompts
                  </Text>
                  <Text textStyle="2xs" color="fg.subtle">
                    {describeRealPrompts({
                      hasProject: Boolean(selectedProjectId),
                      useRealPrompts,
                      loading: promptsQuery.isLoading,
                      promptCount: promptsQuery.prompts?.length ?? 0,
                    })}
                  </Text>
                </Box>
                <Switch
                  size="sm"
                  colorPalette="orange"
                  checked={useRealPrompts}
                  onCheckedChange={(d) => setUseRealPrompts(d.checked)}
                  disabled={!selectedProjectId}
                />
              </Flex>
            </Box>

            {/* Generate button */}
            <Button
              size="sm"
              colorPalette="orange"
              onClick={handleGenerate}
              w="full"
              disabled={useRealPrompts && (promptsQuery.isLoading || !promptsQuery.prompts?.length)}
            >
              <Sparkles size={14} />
              Generate {targetSpanCount.toLocaleString()} spans
            </Button>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}
