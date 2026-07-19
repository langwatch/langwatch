import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { PromptPlaygroundPageLayout } from "~/prompts/prompt-playground/components/PromptPlaygroundPage.layout";
import "@copilotkit/react-ui/styles.css";

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
