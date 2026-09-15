/**
 * What the Conversation tab shows when this deployment runs no chat runtime.
 *
 * The alternative it replaces is worse than a missing tab: the chat rendered,
 * took a message, posted it to a path the API declares absent at boot, and
 * showed the reader nothing but a failed request. A surface that cannot work
 * has to say so where the reader is standing, at the moment they would
 * otherwise start typing.
 *
 * Both sentences are the host's, resolved from the error registry that owns
 * every other word a customer reads about a failure. This component only
 * arranges them.
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
