import { PromptStudioPageLayout } from "~/prompt-configs/prompt-studio/components/PromptStudioPage.layout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { DashboardLayout } from "~/components/DashboardLayout";

/**
 * Prompts page
 * Single Responsibility: Route and permission handling for prompts
 */
function Page() {
  return <PromptStudioPageLayout />;
}

export default withPermissionGuard("prompts:view", {
  layoutComponent: DashboardLayout,
})(Page);
