import { Button, type ButtonProps, useDisclosure } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { NewWorkflowModal } from "../../optimization_studio/components/workflow/NewWorkflowModal";

export const CreateWorkflowButton = ({ props }: { props?: ButtonProps }) => {
  const { open, onClose, onOpen } = useDisclosure();

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
