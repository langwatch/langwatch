import { DashboardLayout } from "~/components/DashboardLayout";
import { PromptStudioSidebar } from "~/prompt-configs/prompt-studio/components/sidebar/PromptStudioSidebar";
import { PromptStudioMainContent } from "~/prompt-configs/prompt-studio/components/PromptStudioMainContent";
import { Box, HStack } from "@chakra-ui/react";
import { PromptConfigProvider } from "~/prompt-configs/providers/PromptConfigProvider";

export function PromptStudioLayout() {
  return (
    <DashboardLayout position="relative">
      <HStack width="full" height="full" gap={0} position="relative">
        <PromptConfigProvider>
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
              paddingY="3"
              bg="white"
            >
              <PromptStudioSidebar />
            </Box>
          </HStack>
          <PromptStudioMainContent />
        </PromptConfigProvider>
      </HStack>
    </DashboardLayout>
  );
}
