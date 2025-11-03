import { useEffect, useMemo } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { AssistantMessage, CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import type { z } from "zod";
import { type runtimeInputsSchema } from "~/prompt-configs/schemas/field-schemas";
import { SyncedChatInput } from "./SyncedChatInput";
import { TraceMessage } from "~/components/copilot-kit/TraceMessage";
import { Box, type BoxProps } from "@chakra-ui/react";
import clsx from "clsx";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { useTabId } from "../prompt-browser/ui/TabContext";
import { convertScenarioMessagesToCopilotKit } from "~/components/simulations/utils/convert-scenario-messages";

interface PromptStudioChatProps extends BoxProps {
  formValues: PromptConfigFormValues;
  variables?: z.infer<typeof runtimeInputsSchema>;
}

export function PromptStudioChat(props: PromptStudioChatProps) {
  const { formValues, variables, ...boxProps } = props;
  const { project } = useOrganizationTeamProject();
  const additionalParams = useMemo(() => {
    return JSON.stringify({
      formValues,
      variables,
    });
  }, [formValues, variables]);

  return (
    <Box
      width="full"
      height="full"
      {...boxProps}
      className={clsx("prompt-studio-chat", boxProps.className)}
    >
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
        initialMessagesFromSpanData={[
          {
            id: "1",
            role: "user",
            content: "Hello, how are you?",
          },
        ]}
      >
        <PromptStudioChatInner />
      </CopilotKit>
    </Box>
  );
}

function PromptStudioChatInner() {
  const tabId = useTabId();
  const { getTabById } = useDraggableTabsBrowserStore((state) => ({
    getTabById: state.getByTabId,
  }));
  const { setMessages } = useCopilotChat({});

  useEffect(() => {
    const tab = getTabById(tabId);
    const initialMessagesFromSpanData = tab?.chat?.initialMessagesFromSpanData;
    if (initialMessagesFromSpanData?.length) {
      void setMessages(
        convertScenarioMessagesToCopilotKit(initialMessagesFromSpanData as any),
      );
    }
  }, [setMessages, tabId, getTabById]);

  return (
    <CopilotChat
      Input={SyncedChatInput}
      AssistantMessage={(props) => {
        return (
          <>
            <AssistantMessage {...props} />
            {!props.isLoading && !props.isGenerating && (
              <TraceMessage traceId={props.rawData.id} marginTop={2} />
            )}
          </>
        );
      }}
    />
  );
}
