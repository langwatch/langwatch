import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, Flex, HStack, Skeleton } from "@langwatch/design-system/primitives";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { useTraceStore } from "../../../features/foundry/behavior/trace.store.ts";
import { FoundryTransport } from "../../../features/foundry/ui/sections/foundry-transport.tsx";
import { GenerateConversationDialog } from "../../../features/foundry/ui/sections/generate-conversation-dialog.tsx";
import { GenerateTraceDialog } from "../../../features/foundry/ui/sections/generate-trace-dialog.tsx";
import { PlaygroundContent } from "../../../features/foundry/ui/sections/playground-content.tsx";
import { PresetPicker } from "../../../features/foundry/ui/sections/preset-picker.tsx";

export default function OpsFoundryScreen() {
  const resetTrace = useTraceStore((s) => s.resetTrace);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <FoundryTransport includeProjects>
      <PageLayout.Header height="auto" minHeight="56px" paddingY={2}>
        <Flex align="center" justify="space-between" gap={3} wrap="wrap" w="full">
          <PageLayout.Heading>Foundry</PageLayout.Heading>
          <HStack gap={2} wrap="wrap">
            <GenerateConversationDialog />
            <GenerateTraceDialog />
            <PresetPicker />
            <PageLayout.HeaderButton onClick={resetTrace}>
              <RotateCcw size={16} />
              Reset
            </PageLayout.HeaderButton>
          </HStack>
        </Flex>
      </PageLayout.Header>
      <Box
        height="calc(100dvh - 144px)"
        minHeight="520px"
        padding={4}
        w="full"
        overflow="hidden"
        borderTopLeftRadius="inherit"
      >
        <Box
          height="full"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="lg"
          overflow="hidden"
        >
          {mounted ? <PlaygroundContent /> : <Skeleton height="full" />}
        </Box>
      </Box>
    </FoundryTransport>
  );
}
