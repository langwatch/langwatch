/**
 * Prompt Studio - the whole `/:project/prompts` page. `DashboardLayout` does
 * not travel (header, product menu, command bar, Langy dock, drawer registry
 * belong to the composing application); this page is a child of that layout route.
 */

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, Stack, VStack } from "@langwatch/design-system/primitives";

import { useDraggableTabsBrowserStore } from "../../../features/tabs/behavior/use-prompt-tabs-browser-store.ts";
import { PromptPlaygroundChatProvider } from "../../../model/prompt-chat-sync-context.tsx";
import { PromptPlaygroundMainContent } from "./playground-main-content.tsx";
import { PromptConfigProvider } from "./prompt-config-provider.tsx";
import { PromptPlaygroundSidebar } from "./sidebar/prompt-playground-sidebar.tsx";

export function PromptStudioScreen() {
  const hasNoTabs = useDraggableTabsBrowserStore(({ windows }) =>
    windows.every((w) => w.tabs.length === 0),
  );

  // A phone shows one pane at a time: the list until a prompt is open, then the editor.
  return (
    <PromptConfigProvider>
      <PromptPlaygroundChatProvider>
        <Stack
          direction={{ base: "column", md: "row" }}
          width="full"
          height="full"
          gap={0}
          position="relative"
        >
          <VStack
            position="relative"
            top={0}
            left={0}
            width={{ base: "full", md: "250px" }}
            height={{ base: "auto", md: "full" }}
            flexShrink={0}
            display={{ base: hasNoTabs ? "flex" : "none", md: "flex" }}
          >
            <PageLayout.Header withBorder={false}>
              <PageLayout.Heading>Prompts</PageLayout.Heading>
            </PageLayout.Header>
            <PromptPlaygroundSidebar />
          </VStack>
          <Box flex={1} minWidth={0} minHeight={0} width="full" height="full">
            <PromptPlaygroundMainContent />
          </Box>
        </Stack>
      </PromptPlaygroundChatProvider>
    </PromptConfigProvider>
  );
}

export default PromptStudioScreen;
