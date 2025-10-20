import { DashboardLayout } from "~/components/DashboardLayout";
import { PromptStudioSidebar } from "~/prompt-configs/components/prompt-studio/sidebar/PromptStudioSidebar";
import { PromptStudioMainContent } from "~/prompt-configs/components/prompt-studio/PromptStudioMainContent";
import { HStack, Box } from "@chakra-ui/react";

export function PromptStudioLayout() {
  return (
    <DashboardLayout position="relative">
      <HStack width="full" height="full" gap={0}>
        <PromptStudioSidebar />
        <Box width="full">
          <PromptStudioMainContent />
        </Box>
      </HStack>
    </DashboardLayout>
  );
}
