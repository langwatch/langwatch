import { useMemo } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import type { z } from "zod";
import { type runtimeInputsSchema } from "~/prompt-configs/schemas/field-schemas";
import { SyncedChatInput } from "./SyncedChatInput";
import { TraceMessage } from "~/components/copilot-kit/TraceMessage";
import type { Message } from '@copilotkit/runtime-client-gql';

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

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{
        "X-Auth-Token": project?.apiKey ?? "",
      }}
      forwardedParameters={{
        // @ts-expect-error - Total hack to pass additional params to the service adapter
        model: additionalParams,
      }}
      onError={(error: Error) => {
        console.error(error);
      }}
      disableSystemMessage
    >
      <PromptStudioChatInner />
    </CopilotKit>
  );
}

function PromptStudioChatInner() {
  const { visibleMessages } = useCopilotChat();

  console.log("visibleMessages", visibleMessages);
  return (
    <CopilotChat
      Input={SyncedChatInput}
      RenderAgentStateMessage={({ message }) => {
        const message_ = message as Message & { state: { traceId: string } };
        return <TraceMessage traceId={message_.state.traceId} marginLeft="auto" />;
      }}
    />
  );
}
