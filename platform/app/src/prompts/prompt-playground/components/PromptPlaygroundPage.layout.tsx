import { HStack, VStack } from "@chakra-ui/react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
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
      <PromptConfigProvider>
        <PromptPlaygroundChatProvider>
          <HStack width="full" height="full" gap={0} position="relative">
            {/* The prompts rail and the workspace share the page ground and are
                told apart by the card the workspace holds, not by a rule
                between them: a hairline here put a second edge a few pixels
                from the card's own. */}
            <VStack
              position="relative"
              top={0}
              left={0}
              width="250px"
              flexShrink={0}
              height="full"
              gap={0}
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
