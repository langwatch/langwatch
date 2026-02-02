import { Box, HStack, Link, Spinner, Text } from "@chakra-ui/react";
import { ChevronDown, ExternalLink, Plus } from "lucide-react";
import { useRouter } from "next/router";
import { useState } from "react";
import { createInitialState } from "~/evaluations-v3/types";
import { extractPersistedState } from "~/evaluations-v3/types/persistence";
import { useDrawer } from "~/hooks/useDrawer";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { PageLayout } from "../ui/layouts/PageLayout";
import { Menu } from "../ui/menu";

type NewEvaluationMenuProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function NewEvaluationMenu({ open, onOpenChange }: NewEvaluationMenuProps) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const enabled = !!project && hasPermission("evaluations:manage");
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const [isCreatingExperiment, setIsCreatingExperiment] = useState(false);
  const utils = api.useContext();
  const { checkAndProceed } = useLicenseEnforcement("experiments");

  const createExperiment = api.experiments.saveEvaluationsV3.useMutation({
    onSuccess: (data) => {
      // Invalidate the experiments list so it's up to date when navigating back
      void utils.experiments.getAllForEvaluationsList.invalidate();
      void router.push(`/${project?.slug}/experiments/workbench/${data.slug}`);
      setIsCreatingExperiment(false);
    },
    onError: () => {
      setIsCreatingExperiment(false);
    },
  });

  if (!enabled) return null;

  const handleCreateExperiment = () => {
    checkAndProceed(() => {
      if (!project?.id || isCreatingExperiment) return;

      setIsCreatingExperiment(true);

      // Generate human-readable name like "swift-bright-fox"
      const name = generateHumanReadableId();

      // Create initial state with the generated name
      const initialState = createInitialState();
      initialState.name = name;

      // Extract persisted state for saving
      const persistedState = extractPersistedState(initialState);

      createExperiment.mutate({
        projectId: project.id,
        experimentId: undefined,
        state: {
          ...persistedState,
          experimentSlug: name, // Use the name as the slug (already unique)
        } as Parameters<typeof createExperiment.mutate>[0]["state"],
      });
    });
  };

  const handleNewOnlineEvaluation = () => {
    openDrawer("onlineEvaluation", {});
  };

  const handleNewGuardrail = () => {
    openDrawer("guardrails", {});
  };

  return (
    <>
      <Menu.Root open={open} onOpenChange={(e) => onOpenChange?.(e.open)}>
        <Menu.Trigger asChild>
          <PageLayout.HeaderButton>
            <Plus size={16} />
            New Evaluation
            <ChevronDown size={14} />
          </PageLayout.HeaderButton>
        </Menu.Trigger>
        <Menu.Content minWidth="320px">
          <Menu.Item
            value="experiment"
            onClick={handleCreateExperiment}
            disabled={isCreatingExperiment}
          >
            <Box width="100%">
              <Text fontWeight="medium">
                {isCreatingExperiment && <Spinner size="xs" marginRight={2} />}
                Create Experiment
              </Text>
              <Text fontSize="xs" color="gray.500">
                Compare prompts and agents performance side by side
              </Text>
            </Box>
          </Menu.Item>
          <Menu.Item value="onlineEvaluation" onClick={handleNewOnlineEvaluation}>
            <Box width="100%">
              <Text fontWeight="medium">Add Online Evaluation</Text>
              <Text fontSize="xs" color="gray.500">
                Monitor live traces and capture performance signals
              </Text>
            </Box>
          </Menu.Item>
          <Menu.Item value="guardrail" onClick={handleNewGuardrail}>
            <Box width="100%">
              <Text fontWeight="medium">Setup Guardrail</Text>
              <Text fontSize="xs" color="gray.500">
                Block dangerous requests and harmful outputs
              </Text>
            </Box>
          </Menu.Item>
          <Menu.Item value="monitor" asChild>
            <Link href="https://langwatch.ai/docs/evaluations/experiments/sdk" target="_blank">
              <Box width="100%">
                <HStack>
                  <Text fontWeight="medium">Evaluate via SDK</Text>
                  <ExternalLink size={14} style={{ marginTop: "-2px" }} />
                </HStack>
                <Text fontSize="xs" color="gray.500">
                  Run evaluations programmatically from notebooks or scripts
                </Text>
              </Box>
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </>
  );
}
