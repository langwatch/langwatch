/**
 * What the Conversation tab shows when no chat runtime is deployed - the
 * alternative posts to a path the API declares absent and fails silently.
 * Both sentences are the host's, from the error registry; this component just arranges them.
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
