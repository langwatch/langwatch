import { useMemo } from "react";
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
  const additionalParams = useMemo(() => {
    return JSON.stringify({
      formValues,
      variables,
    });
  }, [formValues, variables]);

  console.log("additionalParams", {
    variables,
  });

  return (
    <CopilotKit
      height="full"
      runtimeUrl="/api/copilotkit"
      headers={{
        "X-Auth-Token": project?.apiKey ?? "",
      }}
      forwardedParameters={{
        // @ts-expect-error - Total hack to pass additional params to the service adapter
        model: additionalParams,
      }}
      onError={(error) => {
        console.error(error);
      }}
    >
      <CopilotChat
        onError={(error) => {
          console.error(error);
        }}
      />
    </CopilotKit>
  );
}
