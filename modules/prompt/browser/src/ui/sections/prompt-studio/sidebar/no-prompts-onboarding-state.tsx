import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Button, Center } from "@langwatch/design-system/primitives";
import { AggregateReadOnlyNotice } from "@langwatch/error-views";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { SetupWithAgentButton } from "@langwatch/trace-client";
import { LuSparkles } from "react-icons/lu";

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
      <NoDataInfoBlock
        icon={<LuSparkles />}
        title="Create your first prompt"
        description="Design, test and optimise your prompts in the playground."
        primaryAction={
          <Button
            colorPalette="orange"
            size="sm"
            data-testid="prompt-new-button"
            onClick={() => void createDraftPrompt()}
          >
            Create first prompt
          </Button>
        }
        secondaryAction={<SetupWithAgentButton surface="prompts" />}
      />
    </Center>
  );
}
