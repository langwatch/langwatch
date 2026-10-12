import { Box, Button, Center, EmptyState, HStack } from "@chakra-ui/react";
import { LuSparkles } from "react-icons/lu";
import { AggregateReadOnlyNotice } from "~/components/projects/AggregateReadOnlyNotice";
import { SetupWithAgentButton } from "~/components/SetupWithAgentButton";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";
import { useCreateDraftPrompt } from "../../../hooks/useCreateDraftPrompt";

/**
 * Onboarding empty state for when user has no prompts at all.
 * Single Responsibility: Display positive first-time user experience with CTA.
 */
export function NoPromptsOnboardingState() {
  const { project } = useOrganizationTeamProject();
  const { createDraftPrompt } = useCreateDraftPrompt();

  // An aggregate (ADR-144) keeps no prompts of its own, and the server
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
            Get started on the prompt playground to design, test, and optimize
            your AI prompts in one place.
          </EmptyState.Description>
          <HStack gap={2}>
            <Button
              variant="outline"
              size="sm"
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
