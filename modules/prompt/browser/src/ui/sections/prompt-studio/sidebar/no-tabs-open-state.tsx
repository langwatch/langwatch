import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Center, Spacer, VStack } from "@langwatch/design-system/primitives";
import { LuFileText } from "react-icons/lu";

import { AddPromptButton } from "./add-prompt-button.tsx";

/**
 * Empty state for when user has prompts but no tabs open.
 * Single Responsibility: Guide users to open existing prompts or create new ones.
 */
export function NoTabsOpenState() {
  return (
    <VStack width="full" height="full">
      <PageLayout.Header withBorder={false}>
        <Spacer />
        <AddPromptButton />
      </PageLayout.Header>
      <Center width="full" height="full" bg="bg.panel">
        <NoDataInfoBlock
          icon={<LuFileText />}
          title="No prompts open"
          description="Create a new prompt or select an existing prompt to get started."
          next={[
            {
              kind: "docs",
              label: "Read about prompt management",
              href: "https://docs.langwatch.ai/prompt-management/overview",
            },
          ]}
        />
      </Center>
    </VStack>
  );
}
