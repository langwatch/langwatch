import { Button, Center, EmptyState } from "@chakra-ui/react";
import { LuSparkles } from "react-icons/lu";
import { useCreateDraftPrompt } from "../../../hooks/useCreateDraftPrompt";

/**
 * Onboarding empty state for when user has no prompts at all.
 * Single Responsibility: Display positive first-time user experience with CTA.
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
            Get started on the prompt playground to design, test, and optimize
            your AI prompts in one place.
          </EmptyState.Description>
          <Button
            colorPalette="orange"
            variant="solid"
            onClick={() => void createDraftPrompt()}
          >
            Create First Prompt
          </Button>
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
}
