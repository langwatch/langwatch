import { Box, Button, Center, Flex, HStack, Text, VStack } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { GenerateConversationDialog } from "../../features/foundry/ui/sections/generate-conversation-dialog";
import { GenerateTraceDialog } from "../../features/foundry/ui/sections/generate-trace-dialog";
import { PlaygroundContent } from "../../features/foundry/ui/sections/playground-content";
import { PresetPicker } from "../../features/foundry/ui/sections/preset-picker";
import { FoundryTransport } from "../../features/foundry/ui/sections/foundry-transport";
import { useTraceStore } from "../../features/foundry/behavior/trace.store";

const SPLASH_LINES = [
  "Warming up the flux capacitor...",
  "Calibrating span generators...",
  "Untangling distributed traces...",
  "Teaching spans about their parents...",
  "Inflating token counts for drama...",
  "Reticulating splines (the OTel ones)...",
  "Asking the LLM to be patient...",
];

function Splash() {
  const [line] = useState(() => SPLASH_LINES[Math.floor(Math.random() * SPLASH_LINES.length)]!);

  return (
    <Center h="full">
      <VStack gap={3}>
        <Text fontSize="lg" fontWeight="semibold" color="fg.default">
          The Foundry
        </Text>
        <Text fontSize="sm" color="fg.muted" fontStyle="italic">
          {line}
        </Text>
      </VStack>
    </Center>
  );
}

export default function OpsFoundryScreen() {
  const resetTrace = useTraceStore((s) => s.resetTrace);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <FoundryTransport includeProjects>
      <PageLayout.Header>
        <Flex align="center" justify="space-between" w="full">
          <PageLayout.Heading>The Foundry</PageLayout.Heading>
          <HStack gap={2}>
            <GenerateConversationDialog />
            <GenerateTraceDialog />
            <PresetPicker />
            <Button size="xs" variant="outline" onClick={resetTrace}>
              <RotateCcw size={14} />
              Reset
            </Button>
          </HStack>
        </Flex>
      </PageLayout.Header>
      <Box
        height="calc(100vh - 56px - 48px)"
        w="full"
        overflow="hidden"
        borderTopLeftRadius="inherit"
      >
        {mounted ? <PlaygroundContent /> : <Splash />}
      </Box>
    </FoundryTransport>
  );
}
