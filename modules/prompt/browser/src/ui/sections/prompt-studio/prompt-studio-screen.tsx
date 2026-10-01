/**
 * Prompt Studio - the whole `/:project/prompts` page. `DashboardLayout` does
 * not travel (header, product menu, command bar, Langy dock, drawer registry
 * belong to the composing application); this page is a child of that layout route.
 */

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, HStack, VStack } from "@langwatch/design-system/primitives";

import { PromptPlaygroundChatProvider } from "../../../model/prompt-chat-sync-context.tsx";
import { PromptPlaygroundMainContent } from "./playground-main-content.tsx";
import { PromptConfigProvider } from "./prompt-config-provider.tsx";
import { PromptPlaygroundSidebar } from "./sidebar/prompt-playground-sidebar.tsx";

export function PromptStudioScreen() {
  return (
    <PromptConfigProvider>
      <PromptPlaygroundChatProvider>
        <HStack width="full" height="full" gap={0} position="relative">
          <VStack position="relative" top={0} left={0} width="250px" height="full" flexShrink={0}>
            <PageLayout.Header withBorder={false}>
              <PageLayout.Heading>Prompts</PageLayout.Heading>
            </PageLayout.Header>
            <PromptPlaygroundSidebar />
          </VStack>
          <Box flex={1} minWidth={0} height="full">
            <PromptPlaygroundMainContent />
          </Box>
        </HStack>
      </PromptPlaygroundChatProvider>
    </PromptConfigProvider>
  );
}

export default PromptStudioScreen;
