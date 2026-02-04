import { Button, type ButtonProps, useDisclosure } from "@chakra-ui/react";
import { Lock, Plus } from "lucide-react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { NewWorkflowModal } from "../../optimization_studio/components/workflow/NewWorkflowModal";
import { Tooltip } from "../ui/tooltip";

export const CreateWorkflowButton = ({ props }: { props?: ButtonProps }) => {
  const { hasPermission } = useOrganizationTeamProject();

  const hasWorkflowsCreatePermission = hasPermission("workflows:create");

  const { open, onClose, onOpen } = useDisclosure();

  if (!hasWorkflowsCreatePermission) {
    return (
      <Tooltip content="You need workflows:create permission to create workflows">
        <Button
          variant="outline"
          size="sm"
          colorPalette="gray"
          opacity={0.6}
          disabled
        >
          <Lock size={14} />
          Create Workflow
        </Button>
      </Tooltip>
    );
  }

  return (
    <>
      <Button
        data-testid="active-create-new-workflow-button"
        onClick={onOpen}
        size="sm"
        variant="outline"
        {...props}
      >
        <Plus size={16} />
        Create Workflow
      </Button>
      <NewWorkflowModal open={open} onClose={onClose} />
    </>
  );
};
