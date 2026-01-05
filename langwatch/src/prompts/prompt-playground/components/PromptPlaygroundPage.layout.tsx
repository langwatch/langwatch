import { Box, HStack, Spacer, VStack } from "@chakra-ui/react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PromptPlaygroundMainContent } from "~/prompts/prompt-playground/components/PromptPlaygroundMainContent";
import { PromptPlaygroundSidebar } from "~/prompts/prompt-playground/components/sidebar/PromptPlaygroundSidebar";
import { PromptConfigProvider } from "~/prompts/providers/PromptConfigProvider";
import { PromptPlaygroundChatProvider } from "./chat/PromptPlaygroundChatContext";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { AddPromptButton } from "./sidebar/AddPromptButton";

/**
 * PromptPlaygroundLayout
 * Single Responsibility: Renders the main layout structure for the Prompt Playground feature with sidebar and main content.
 */
export function PromptPlaygroundPageLayout() {
  return (
    <DashboardLayout position="relative" compactMenu>
      <PromptConfigProvider>
        <PromptPlaygroundChatProvider>
          <HStack width="full" height="full" gap={0} position="relative">
            <VStack
              position="relative"
              top={0}
              left={0}
              width="250px"
              height="full"
            >
              <PageLayout.Header withBorder={false}>
                <PageLayout.Heading>Prompts</PageLayout.Heading>
              </PageLayout.Header>
              <PromptPlaygroundSidebar />
            </VStack>
            <PromptPlaygroundMainContent />
          </HStack>
        </PromptPlaygroundChatProvider>
      </PromptConfigProvider>
    </DashboardLayout>
  );
}
