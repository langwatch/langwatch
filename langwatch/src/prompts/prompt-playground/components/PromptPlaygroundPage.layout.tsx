import { Box, HStack, Spacer } from "@chakra-ui/react";
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
          <PageLayout.Header>
            <PageLayout.Heading>Prompts</PageLayout.Heading>
            <Spacer />
            <AddPromptButton />
          </PageLayout.Header>
          <HStack width="full" height="full" gap={0} position="relative">
            <HStack
              position="relative"
              top={0}
              left={0}
              width="300px"
              height="full"
            >
              <Box
                position="absolute"
                top={0}
                left={0}
                width="full"
                height="full"
              >
                <PromptPlaygroundSidebar />
              </Box>
            </HStack>
            <PromptPlaygroundMainContent />
          </HStack>
        </PromptPlaygroundChatProvider>
      </PromptConfigProvider>
    </DashboardLayout>
  );
}
