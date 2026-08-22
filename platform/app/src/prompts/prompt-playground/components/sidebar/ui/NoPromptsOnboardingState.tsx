import { Button, Center, EmptyState, HStack } from "@chakra-ui/react";
import { LuSparkles } from "react-icons/lu";
import { SetupWithAgentButton } from "~/components/SetupWithAgentButton";
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
          <EmptyState.Title>Create your first prompt</EmptyState.Title>
          <EmptyState.Description>
            Write the instructions, try a real conversation and save a version
            when it is ready to use.
          </EmptyState.Description>
          <HStack gap={2}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void createDraftPrompt()}
            >
              Create first prompt
            </Button>
            <SetupWithAgentButton surface="prompts" />
          </HStack>
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
}
