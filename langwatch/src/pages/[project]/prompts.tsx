import { PromptStudioLayout } from "~/prompt-configs/prompt-studio/components/PromptStudioLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import "@copilotkit/react-ui/styles.css";
import { DashboardLayout } from "~/components/DashboardLayout";

function PromptStudioPage() {
  return <PromptStudioLayout />;
}

export default withPermissionGuard("prompts:view", {
  layoutComponent: DashboardLayout,
})(PromptStudioPage);
