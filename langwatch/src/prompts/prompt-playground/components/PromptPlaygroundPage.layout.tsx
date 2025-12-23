import { Box, HStack } from "@chakra-ui/react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PromptPlaygroundMainContent } from "~/prompts/prompt-playground/components/PromptPlaygroundMainContent";
import { PromptPlaygroundSidebar } from "~/prompts/prompt-playground/components/sidebar/PromptPlaygroundSidebar";
import { PromptConfigProvider } from "~/prompts/providers/PromptConfigProvider";
import { PromptPlaygroundChatProvider } from "./chat/PromptPlaygroundChatContext";

/**
 * PromptPlaygroundLayout
 * Single Responsibility: Renders the main layout structure for the Prompt Playground feature with sidebar and main content.
 */
export function PromptPlaygroundPageLayout() {
  return (
    <DashboardLayout position="relative" compactMenu>
      <HStack width="full" height="full" gap={0} position="relative">
        <PromptConfigProvider>
          <PromptPlaygroundChatProvider>
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
          </PromptPlaygroundChatProvider>
        </PromptConfigProvider>
      </HStack>
    </DashboardLayout>
  );
}
