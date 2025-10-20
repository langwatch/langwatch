import { DashboardLayout } from "~/components/DashboardLayout";
import { PromptStudioSidebar } from "~/prompt-configs/components/prompt-studio/sidebar/PromptStudioSidebar";
import { PromptStudioMainContent } from "~/prompt-configs/components/prompt-studio/PromptStudioMainContent";

export function PromptStudioLayout() {
  return (
    <DashboardLayout position="relative">
      <PromptStudioSidebar />
      <PromptStudioMainContent />
    </DashboardLayout>
  );
}
