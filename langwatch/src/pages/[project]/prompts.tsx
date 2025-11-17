import { PromptPlaygroundPageLayout } from "~/prompt-configs/prompt-playground/components/PromptPlaygroundPage.layout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { DashboardLayout } from "~/components/DashboardLayout";

/**
 * Prompts page
 * Single Responsibility: Route and permission handling for prompts
 */
function Page() {
  return <PromptPlaygroundPageLayout />;
}

export default withPermissionGuard("prompts:view", {
  layoutComponent: DashboardLayout,
})(Page);
