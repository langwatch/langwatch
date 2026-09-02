/**
 * Prompt Studio — the whole `/:project/prompts` page.
 *
 * `DashboardLayout` does not travel, and that is the same chrome gap every
 * family since the gateway has recorded: 738 lines of header, product menu,
 * command bar, Langy dock and drawer registry belong to the composing
 * application, and this page is a child of a layout route it still serves. The
 * `compactMenu` flag went with it — the studio asked the application's product
 * menu to collapse so the prompt sidebar had room, and there is no capability
 * for a screen to ask that of a chrome it no longer knows about.
 *
 * Everything else is unchanged: the prompt-config dialogs and the chat-sync
 * context wrap a two-column layout, the sidebar on the left and the tabbed
 * browser on the right.
 */

import { HStack, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { PromptPlaygroundChatProvider } from "../../model/prompt-chat-sync-context";
import { PromptPlaygroundMainContent } from "./playground-main-content";
import { PromptConfigProvider } from "./prompt-config-provider";
import { PromptPlaygroundSidebar } from "./sidebar/prompt-playground-sidebar";

export function PromptStudioScreen() {
  return (
    <PromptConfigProvider>
      <PromptPlaygroundChatProvider>
        <HStack width="full" height="full" gap={0} position="relative">
          <VStack position="relative" top={0} left={0} width="250px" height="full">
            <PageLayout.Header withBorder={false}>
              <PageLayout.Heading>Prompts</PageLayout.Heading>
            </PageLayout.Header>
            <PromptPlaygroundSidebar />
          </VStack>
          <PromptPlaygroundMainContent />
        </HStack>
      </PromptPlaygroundChatProvider>
    </PromptConfigProvider>
  );
}

export default PromptStudioScreen;
