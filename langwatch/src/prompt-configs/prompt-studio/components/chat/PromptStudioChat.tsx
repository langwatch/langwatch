import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompt-configs/types";

interface PromptStudioChatProps {
  formValues: PromptConfigFormValues;
}

export function PromptStudioChat({ formValues }: PromptStudioChatProps) {
  const { project } = useOrganizationTeamProject();
  return (
    <CopilotKit
      height="full"
      runtimeUrl="/api/copilotkit"
      headers={{
        "X-Auth-Token": project?.apiKey ?? "",
      }}
      forwardedParameters={{
        // @ts-expect-error - Total hack
        model: JSON.stringify(formValues),
      }}
    >
      <CopilotChat />
    </CopilotKit>
  );
}
