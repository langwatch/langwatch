import { Box, HStack, Link, Spinner, Text } from "@chakra-ui/react";
import { ChevronDown, ExternalLink, Plus } from "lucide-react";
import { useState } from "react";

import { createInitialState } from "../../../model/experiments-v3/types";
import { extractPersistedState } from "../../../model/experiments-v3/types/persistence";
import { showErrorToast } from "@langwatch/workflow-web/studio-host/errors";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { useRouter } from "@langwatch/workflow-web/studio-host/next-router";
import { generateHumanReadableId } from "@langwatch/experiment-contract";

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Menu } from "@langwatch/design-system/menu";

export const CreateExperimentButton = () => {
  const { project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const utils = api.useUtils();
  const createExperiment = api.experiments.saveEvaluationsV3.useMutation({
    onSuccess: (data) => {
      void utils.experiments.getAllForEvaluationsList.invalidate();
      void router.push(`/${project?.slug}/experiments/workbench/${data.slug}`);
      setIsCreating(false);
    },
    onError: (error) => {
      setIsCreating(false);
      showErrorToast({
        error,
        fallbackTitle: "Couldn't create the experiment",
      });
    },
  });

  if (!project || !hasPermission("experiments:update")) return null;

  const handleCreate = () => {
    if (isCreating) return;

    setIsCreating(true);
    const name = generateHumanReadableId();
    const initialState = createInitialState();
    initialState.name = name;
    const persistedState = extractPersistedState(initialState);

    createExperiment.mutate({
      projectId: project.id,
      experimentId: undefined,
      state: {
        ...persistedState,
        experimentSlug: name,
      },
    });
  };

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <PageLayout.HeaderButton background="bg">
          <Plus size={16} />
          New Experiment
          <ChevronDown size={14} />
        </PageLayout.HeaderButton>
      </Menu.Trigger>
      <Menu.Content minWidth="320px">
        <Menu.Item value="experiment-ui" onClick={handleCreate} disabled={isCreating}>
          <Box width="100%">
            <Text fontWeight="medium">
              {isCreating && <Spinner size="xs" marginRight={2} />}
              Create Experiment
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Compare prompts and agents performance side by side
            </Text>
          </Box>
        </Menu.Item>
        <Menu.Item value="experiment-sdk" asChild>
          <Link href="https://langwatch.ai/docs/evaluations/experiments/sdk" target="_blank">
            <Box width="100%">
              <HStack gap={1}>
                <Text fontWeight="medium">New Experiment via SDK</Text>
                <ExternalLink size={14} />
              </HStack>
              <Text fontSize="xs" color="fg.muted">
                Run experiments programmatically from notebooks or scripts
              </Text>
            </Box>
          </Link>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
};
