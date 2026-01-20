import { Box, Text, useDisclosure } from "@chakra-ui/react";
import { ChevronDown, Plus } from "lucide-react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { Menu } from "../ui/menu";
import { PageLayout } from "../ui/layouts/PageLayout";
import { NewExperimentDialog } from "./NewExperimentDialog";

export function NewEvaluationMenu() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const enabled = !!project && hasPermission("evaluations:manage");
  const { openDrawer } = useDrawer();
  const {
    open: isExperimentDialogOpen,
    onOpen: openExperimentDialog,
    setOpen: setIsExperimentDialogOpen,
  } = useDisclosure();

  if (!enabled) return null;

  const handleNewOnlineEvaluation = () => {
    openDrawer("onlineEvaluation", {});
  };

  const handleNewGuardrail = () => {
    openDrawer("guardrails", {});
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <PageLayout.HeaderButton>
            <Plus size={16} />
            New Evaluation
            <ChevronDown size={14} />
          </PageLayout.HeaderButton>
        </Menu.Trigger>
        <Menu.Content minWidth="320px">
          <Menu.Item value="experiment" onClick={openExperimentDialog}>
            <Box width="100%">
              <Text fontWeight="medium">New Experiment</Text>
              <Text fontSize="xs" color="gray.500">
                Compare prompts and model performance side by side
              </Text>
            </Box>
          </Menu.Item>
          <Menu.Item value="onlineEvaluation" onClick={handleNewOnlineEvaluation}>
            <Box width="100%">
              <Text fontWeight="medium">New Online Evaluation</Text>
              <Text fontSize="xs" color="gray.500">
                Monitor live traces and capture performance signals
              </Text>
            </Box>
          </Menu.Item>
          <Menu.Item value="guardrail" onClick={handleNewGuardrail}>
            <Box width="100%">
              <Text fontWeight="medium">New Guardrail</Text>
              <Text fontSize="xs" color="gray.500">
                Block dangerous requests and harmful outputs
              </Text>
            </Box>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
      <NewExperimentDialog
        open={isExperimentDialogOpen}
        onOpenChange={({ open }) => setIsExperimentDialogOpen(open)}
      />
    </>
  );
}
