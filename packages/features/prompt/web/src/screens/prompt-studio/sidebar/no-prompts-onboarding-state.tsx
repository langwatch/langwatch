import { Button, Center, EmptyState, HStack } from "@chakra-ui/react";
import { LuSparkles } from "react-icons/lu";
import { useCreateDraftPrompt } from "../../../behavior/use-create-draft-prompt";

/**
 * What a project with no prompts at all shows.
 *
 * `SetupWithAgentButton` DID NOT TRAVEL: it is 367 lines of `platform/app`
 * chrome reaching Langy, and `apps/ui` may not import `@langwatch/langy-web`.
 * The same loss the me, automations, agents and datasets families took.
 */
export function NoPromptsOnboardingState() {
  const { createDraftPrompt } = useCreateDraftPrompt();

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
            <Button variant="outline" size="sm" onClick={() => void createDraftPrompt()}>
              Create First Prompt
            </Button>
          </HStack>
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
}
