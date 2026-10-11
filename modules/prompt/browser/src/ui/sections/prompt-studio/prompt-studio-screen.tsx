/**
 * Prompt Studio - the whole `/:project/prompts` page. `DashboardLayout` does
 * not travel (header, product menu, command bar, Langy dock, drawer registry
 * belong to the composing application); this page is a child of that layout route.
 */

import { Drawer } from "@langwatch/design-system/drawer";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, HStack, useBreakpointValue, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";
import { LuPanelLeft } from "react-icons/lu";

import { useDraggableTabsBrowserStore } from "../../../features/tabs/behavior/use-prompt-tabs-browser-store.ts";
import { PromptPlaygroundChatProvider } from "../../../model/prompt-chat-sync-context.tsx";
import { PromptPlaygroundMainContent } from "./playground-main-content.tsx";
import { PromptConfigProvider } from "./prompt-config-provider.tsx";
import { PromptPlaygroundSidebar } from "./sidebar/prompt-playground-sidebar.tsx";

export function PromptStudioScreen() {
  const isCompact = useBreakpointValue({ base: true, md: false }, { fallback: "md" }) === true;

  return (
    <PromptConfigProvider>
      <PromptPlaygroundChatProvider>
        {isCompact ? (
          <CompactStudio />
        ) : (
          <HStack width="full" height="full" gap={0} position="relative">
            <VStack
              position="relative"
              top={0}
              left={0}
              width="250px"
              height="full"
              flexShrink={0}
              borderRightWidth="1px"
              borderColor="border"
            >
              <PageLayout.Header withBorder={false}>
                <PageLayout.Heading>Prompts</PageLayout.Heading>
              </PageLayout.Header>
              <PromptPlaygroundSidebar />
            </VStack>
            <Box flex={1} minWidth={0} height="full">
              <PromptPlaygroundMainContent />
            </Box>
          </HStack>
        )}
      </PromptPlaygroundChatProvider>
    </PromptConfigProvider>
  );
}

/** Below the medium breakpoint the prompt list moves into a drawer the header opens. */
function CompactStudio() {
  const [isListOpen, setIsListOpen] = useState(false);
  const tabCount = useDraggableTabsBrowserStore((state) =>
    state.windows.reduce((count, tabbedWindow) => count + tabbedWindow.tabs.length, 0),
  );

  // Choosing a prompt adds a tab; that is the sidebar's own selection, so the drawer follows it.
  useEffect(() => {
    setIsListOpen(false);
  }, [tabCount]);

  return (
    <VStack width="full" height="full" gap={0} align="stretch">
      <PageLayout.Header
        withBorder={false}
        actions={
          <PageLayout.HeaderButton
            onClick={() => setIsListOpen(true)}
            aria-label="Browse prompts"
            aria-haspopup="dialog"
          >
            <LuPanelLeft size="18px" />
            Browse
          </PageLayout.HeaderButton>
        }
      >
        <PageLayout.Heading>Prompts</PageLayout.Heading>
      </PageLayout.Header>
      <Box flex={1} minWidth={0} minHeight={0}>
        <PromptPlaygroundMainContent />
      </Box>
      <Drawer
        open={isListOpen}
        onClose={() => setIsListOpen(false)}
        title="Prompts"
        size="sm"
        body="flush"
        bodyScroll="content"
      >
        <PromptPlaygroundSidebar />
      </Drawer>
    </VStack>
  );
}

export default PromptStudioScreen;
