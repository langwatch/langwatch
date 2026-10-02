import { Link } from "@langwatch/browser-host/link";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, HStack, Spinner, Text } from "@langwatch/design-system/primitives";
import { ChevronDown, ExternalLink, Plus } from "lucide-react";

export const CreateExperimentButton = ({
  isCreating,
  onCreate,
}: {
  isCreating: boolean;
  onCreate: () => void;
}) => {
  const { project, hasPermission } = useOrganizationTeamProject();

  if (!project || !hasPermission("experiments:update")) return null;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <PageLayout.HeaderButton background="bg" data-testid="experiment-new-open">
          <Plus size={16} />
          New Experiment
          <ChevronDown size={14} />
        </PageLayout.HeaderButton>
      </Menu.Trigger>
      <Menu.Content minWidth="320px">
        <Menu.Item
          value="experiment-ui"
          data-testid="experiment-new-create"
          onClick={onCreate}
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
