import { DashboardLayout } from "~/components/DashboardLayout";
import { PromptStudioSidebar } from "~/prompt-configs/prompt-studio/components/sidebar/PromptStudioSidebar";
import { PromptStudioMainContent } from "~/prompt-configs/prompt-studio/components/PromptStudioMainContent";
import { HStack } from "@chakra-ui/react";
import { PromptConfigProvider } from "~/prompt-configs/providers/PromptConfigProvider";

export function PromptStudioLayout() {
  return (
    <DashboardLayout position="relative">
      <HStack width="full" height="full" gap={0}>
        <PromptConfigProvider>
          <PromptStudioSidebar />
          <PromptStudioMainContent />
        </PromptConfigProvider>
      </HStack>
    </DashboardLayout>
  );
}
