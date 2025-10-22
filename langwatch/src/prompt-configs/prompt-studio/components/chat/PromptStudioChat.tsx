import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

interface PromptStudioChatProps {
  parameters: {
    temperature?: number;
    model: string;
    maxTokens?: number;
  };
}

export function PromptStudioChat({ parameters }: PromptStudioChatProps) {
  const { project } = useOrganizationTeamProject();
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{
        "X-Auth-Token": project?.apiKey ?? "",
      }}
      properties={{
        projectId: project?.id ?? "",
      }}
      threadId="demo"
      forwardedParameters={parameters}
    >
      <CopilotChat />
    </CopilotKit>
  );
}
