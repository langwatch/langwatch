import { Box, HStack, Link, Spinner, Text } from "@chakra-ui/react";
import { ChevronDown, ExternalLink, Plus } from "lucide-react";
import { useState } from "react";

import { createInitialState } from "~/experiments-v3/types";
import { extractPersistedState } from "~/experiments-v3/types/persistence";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { isHandledByGlobalHandler } from "~/utils/trpcError";

import { PageLayout } from "../ui/layouts/PageLayout";
import { Menu } from "../ui/menu";
import { toaster } from "../ui/toaster";

export const CreateExperimentButton = () => {
  const { project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const utils = api.useContext();
  const { checkAndProceed } = useLicenseEnforcement("experiments");
  const createExperiment = api.experiments.saveEvaluationsV3.useMutation({
    onSuccess: (data) => {
      void utils.experiments.getAllForEvaluationsList.invalidate();
      void router.push(`/${project?.slug}/experiments/workbench/${data.slug}`);
      setIsCreating(false);
    },
    onError: (error) => {
      setIsCreating(false);
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Error creating experiment",
        description:
          error instanceof Error
            ? error.message
            : "Please try again. If the problem persists, contact support.",
        type: "error",
        meta: {
          closable: true,
        },
      });
    },
  });

  if (!project || !hasPermission("workflows:create")) return null;

  const handleCreate = () => {
    checkAndProceed(() => {
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
        <Menu.Item
          value="experiment-ui"
          onClick={handleCreate}
          disabled={isCreating}
        >
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
          <Link
            href="https://langwatch.ai/docs/evaluations/experiments/sdk"
            target="_blank"
          >
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
