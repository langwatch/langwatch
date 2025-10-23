import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import type { z } from "zod";
import { type runtimeInputsSchema } from "~/prompt-configs/schemas/field-schemas";

interface PromptStudioChatProps {
  formValues: PromptConfigFormValues;
  variables?: z.infer<typeof runtimeInputsSchema>;
}

export function PromptStudioChat({
  formValues,
  variables,
}: PromptStudioChatProps) {
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
        variables: JSON.stringify(variables ?? []),
      }}
    >
      <CopilotChat />
    </CopilotKit>
  );
}
