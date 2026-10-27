/**
 * What the Conversation tab shows when no chat runtime is deployed - the
 * alternative posts to a path the API declares absent and fails silently.
 * Both sentences are the host's, from the error registry; this component just arranges them.
 */

import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { VStack } from "@langwatch/design-system/primitives";
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
      <NoDataInfoBlock
        size="inline"
        bordered={false}
        icon={<MessageSquareOff />}
        title={title}
        description={description}
        next={[
          {
            kind: "docs",
            label: "Prompt playground",
            href: "https://docs.langwatch.ai/prompt-management/prompt-playground",
          },
        ]}
      />
    </VStack>
  );
}
