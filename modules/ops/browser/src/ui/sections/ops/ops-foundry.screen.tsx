import { Card } from "@langwatch/design-system/card";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, HStack, Skeleton } from "@langwatch/design-system/primitives";
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
      <PageLayout.Header
        actions={
          <HStack gap={2}>
            <GenerateConversationDialog />
            <GenerateTraceDialog />
            <PresetPicker />
            <PageLayout.HeaderButton onClick={resetTrace}>
              <RotateCcw size={16} />
              Reset
            </PageLayout.HeaderButton>
          </HStack>
        }
      >
        <PageLayout.Heading>Foundry</PageLayout.Heading>
      </PageLayout.Header>
      <Box
        height="calc(100dvh - 144px)"
        minHeight="520px"
        padding="var(--page-inset)"
        w="full"
        overflow="hidden"
        display="flex"
        flexDirection="column"
        borderTopLeftRadius="inherit"
      >
        <Card variant="frame-fill">{mounted ? <PlaygroundContent /> : <Skeleton flex={1} />}</Card>
      </Box>
    </FoundryTransport>
  );
}
