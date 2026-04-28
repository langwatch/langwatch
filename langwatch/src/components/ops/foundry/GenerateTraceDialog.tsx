import { useState } from "react";
import { Box, Button, Flex, Text, Input, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { SimpleSlider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { api } from "~/utils/api";
import { useTraceStore } from "./traceStore";
import { useFoundryProjectStore } from "./foundryProjectStore";
import { generateTrace } from "./traceGenerator";
import type { GeneratorOptions, PromptRef } from "./traceGenerator";

const DEPTH_PRESETS = [
  { label: "Shallow", value: 4 },
  { label: "Medium", value: 8 },
  { label: "Deep", value: 14 },
] as const;

export function GenerateTraceDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const setTrace = useTraceStore((s) => s.setTrace);
  const selectedProjectId = useFoundryProjectStore((s) => s.selectedProjectId);

  const [targetSpanCount, setTargetSpanCount] = useState(1500);
  const [depthPreset, setDepthPreset] = useState<number>(1); // index into DEPTH_PRESETS
  const [genaiRatio, setGenaiRatio] = useState(0.8);
  const [useRealPrompts, setUseRealPrompts] = useState(false);
  const [includeEvents, setIncludeEvents] = useState(false);

  const promptsQuery = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: selectedProjectId ?? "" },
    {
      enabled: isOpen && useRealPrompts && !!selectedProjectId,
      staleTime: 60_000,
    },
  );

  function handleGenerate() {
    const prompts: PromptRef[] | undefined =
      useRealPrompts && promptsQuery.data
        ? promptsQuery.data.map((p) => ({
            id: p.id,
            versionId: p.versionId,
            handle: p.handle,
            model: p.model,
            inputs: p.inputs ?? [],
          }))
        : undefined;

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
    <Box position="relative">
      <Button
        size="xs"
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Sparkles size={14} />
        Generate
      </Button>
      {isOpen && (
        <>
          <Box
            position="fixed"
            inset={0}
            zIndex={40}
            onClick={() => setIsOpen(false)}
          />
          <Box
            position="absolute"
            right={0}
            zIndex={50}
            mt={1}
            w="340px"
            rounded="lg"
            border="1px solid"
            borderColor="border"
            bg="bg.panel"
            shadow="xl"
            p={4}
          >
            <Text
              fontSize="sm"
              fontWeight="semibold"
              color="fg.default"
              mb={3}
            >
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
                    setTargetSpanCount(
                      Math.max(10, Math.min(5000, parseInt(e.target.value) || 100))
                    )
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
                      fontSize="10px"
                    >
                      {v >= 1000
                        ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
                        : v}
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
                <Text fontSize="10px" color="fg.subtle" mt={1}>
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
                  onValueChange={(d) =>
                    setGenaiRatio((d.value[0] ?? 80) / 100)
                  }
                />
                <Flex justify="space-between" mt={0.5}>
                  <Text fontSize="10px" color="fg.subtle">
                    Mixed infra
                  </Text>
                  <Text fontSize="10px" color="fg.subtle">
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
                    <Text fontSize="10px" color="fg.subtle">
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
                    <Text fontSize="10px" color="fg.subtle">
                      {!selectedProjectId
                        ? "Select a project first"
                        : useRealPrompts
                          ? promptsQuery.isLoading
                            ? "Loading prompts…"
                            : promptsQuery.data?.length
                              ? `Sampling from ${promptsQuery.data.length} prompt${promptsQuery.data.length === 1 ? "" : "s"}`
                              : "No prompts in this project"
                          : "Attach real prompt IDs to LLM spans"}
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
                disabled={
                  useRealPrompts &&
                  (promptsQuery.isLoading || !promptsQuery.data?.length)
                }
              >
                <Sparkles size={14} />
                Generate {targetSpanCount.toLocaleString()} spans
              </Button>
            </VStack>
          </Box>
        </>
      )}
    </Box>
  );
}
