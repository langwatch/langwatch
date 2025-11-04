import { PromptStudioLayout } from "~/prompt-configs/prompt-studio/components/PromptStudioLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import "@copilotkit/react-ui/styles.css";

function PromptStudioPage() {
  return <PromptStudioLayout />;
}

export default withPermissionGuard("prompts:view")(PromptStudioPage);
