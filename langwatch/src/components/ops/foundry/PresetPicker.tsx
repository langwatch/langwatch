import { useState } from "react";
import { Box, Button, Flex, Text, Badge } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useTraceStore } from "./traceStore";
import { usePresetStore } from "./presetStore";
import type { SpanConfig } from "./types";

function countSpans(spans: SpanConfig[]): number {
  return spans.reduce((acc, s) => acc + 1 + countSpans(s.children), 0);
}

export function PresetPicker() {
  const [isOpen, setIsOpen] = useState(false);
  const setTrace = useTraceStore((s) => s.setTrace);
  const { builtIn, userPresets } = usePresetStore();
  const allPresets = [...builtIn, ...userPresets];

  function loadPreset(id: string) {
    const preset = allPresets.find((p) => p.id === id);
    if (preset) {
      setTrace(structuredClone(preset.config));
      setIsOpen(false);
    }
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
            borderColor="gray.700"
            bg="gray.900"
            shadow="xl"
            p={1}
          >
            <Text fontSize="xs" fontWeight="medium" color="gray.500" px={2} py={1}>
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
                _hover={{ bg: "gray.800" }}
                onClick={() => loadPreset(preset.id)}
              >
                <Flex w="full" justify="space-between" align="center">
                  <Text fontSize="sm" fontWeight="medium" color="gray.200">
                    {preset.name}
                  </Text>
                  <Text fontSize="10px" color="gray.500">
                    {countSpans(preset.config.spans)} spans
                  </Text>
                </Flex>
                <Text fontSize="xs" color="gray.500" lineClamp={1}>
                  {preset.description}
                </Text>
              </Flex>
            ))}
            {userPresets.length > 0 && (
              <>
                <Text fontSize="xs" fontWeight="medium" color="gray.500" px={2} py={1} mt={1}>
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
                    _hover={{ bg: "gray.800" }}
                    onClick={() => loadPreset(preset.id)}
                  >
                    <Flex w="full" justify="space-between" align="center">
                      <Text fontSize="sm" fontWeight="medium" color="gray.200">
                        {preset.name}
                      </Text>
                      <Badge colorPalette="purple" size="sm">Custom</Badge>
                    </Flex>
                    <Text fontSize="xs" color="gray.500" lineClamp={1}>
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
