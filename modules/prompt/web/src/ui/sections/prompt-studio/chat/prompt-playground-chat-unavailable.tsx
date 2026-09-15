/**
 * What the Conversation tab shows when this deployment runs no chat runtime.
 * The alternative is worse than a missing tab: the chat would render, post a
 * message to a path the API declares absent at boot, and fail silently. Both
 * sentences are the host's, resolved from the error registry that owns every
 * other word a customer reads about a failure — this component only arranges
 * them.
 */

import { EmptyState, VStack } from "@chakra-ui/react";
import { MessageSquareOff } from "lucide-react";

export function PromptPlaygroundChatUnavailable({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <VStack height="full" width="full" justify="center" padding={6}>
      <EmptyState.Root size="sm">
        <EmptyState.Content>
          <EmptyState.Indicator>
            <MessageSquareOff />
          </EmptyState.Indicator>
          <VStack textAlign="center" gap={1}>
            <EmptyState.Title>{title}</EmptyState.Title>
            {description ? <EmptyState.Description>{description}</EmptyState.Description> : null}
          </VStack>
        </EmptyState.Content>
      </EmptyState.Root>
    </VStack>
  );
}
