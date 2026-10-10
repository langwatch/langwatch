import { Box, Button, Center, EmptyState, HStack } from "@langwatch/design-system/primitives";
import { AggregateReadOnlyNotice } from "@langwatch/error-views";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { LuSparkles } from "react-icons/lu";

import { SetupWithAgentButton } from "../../../../behavior/lent-setup-with-agent-button.tsx";
import { useCreateDraftPrompt } from "../../../../behavior/use-create-draft-prompt.ts";
import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";

/** What a project with no prompts at all shows. */
export function NoPromptsOnboardingState() {
  const { project } = usePromptProject();
  const { createDraftPrompt } = useCreateDraftPrompt();

  // An aggregate (ADR-177) keeps no prompts of its own, and the server
  // refuses one saved under it.
  if (isAggregateProjectKind(project?.kind)) {
    return (
      <Center width="full" height="full" bg="bg.panel">
        <Box maxWidth="lg">
          <AggregateReadOnlyNotice />
        </Box>
      </Center>
    );
  }

  return (
    <Center width="full" height="full" bg="bg.panel">
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <LuSparkles />
          </EmptyState.Indicator>
          <EmptyState.Title>Create Your First Prompt</EmptyState.Title>
          <EmptyState.Description>
            Get started on the prompt playground to design, test, and optimize your AI prompts in
            one place.
          </EmptyState.Description>
          <HStack gap={2}>
            <Button
              variant="outline"
              size="sm"
              data-testid="prompt-new-button"
              onClick={() => void createDraftPrompt()}
            >
              Create First Prompt
            </Button>
            <SetupWithAgentButton surface="prompts" />
          </HStack>
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
}
