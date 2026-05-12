import { Box } from "@chakra-ui/react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { ThinkingIndicator } from "./ThinkingIndicator";

function isWaitingForResponse(status: ScenarioRunStatus): boolean {
  return (
    status === ScenarioRunStatus.IN_PROGRESS ||
    status === ScenarioRunStatus.PENDING
  );
}

interface ConversationAreaProps {
  messages: ScenarioMessageSnapshotEvent["messages"];
  status: ScenarioRunStatus;
}

/**
 * Renders the conversation thread for a scenario run.
 * Shows messages via CopilotKit and a thinking indicator when the run
 * is still in progress. Renders nothing when there are no messages
 * and the run is not active.
 */
export function ConversationArea({ messages, status }: ConversationAreaProps) {
  const hasMessages = messages.length > 0;
  const waiting = isWaitingForResponse(status);

  if (!hasMessages && !waiting) {
    return null;
  }

  return (
    <Box paddingX={6} paddingY={6} background="bg.muted">
      {hasMessages && (
        <Box borderRadius="md" overflow="hidden">
          <CustomCopilotKitChat
            messages={messages}
            hideInput
            smallerView={false}
          />
        </Box>
      )}
      {waiting && <ThinkingIndicator />}
    </Box>
  );
}
