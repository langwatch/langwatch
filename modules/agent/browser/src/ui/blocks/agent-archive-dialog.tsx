import { DeleteConfirmationDialog } from "@langwatch/design-system/delete-confirmation-dialog";

export type AgentRelatedWorkflow = {
  id: string;
  name: string;
};

export type AgentArchiveDialogProps = {
  open: boolean;
  agentName: string;
  /** The linked workflow, when the agent has one and it has been read. */
  relatedWorkflow: AgentRelatedWorkflow | null;
  isLoading: boolean;
  isLoadingRelated: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function AgentArchiveDialog({
  open,
  agentName,
  relatedWorkflow,
  isLoading,
  isLoadingRelated,
  onClose,
  onConfirm,
}: AgentArchiveDialogProps) {
  return (
    <DeleteConfirmationDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      closeOnConfirm={false}
      title="Delete agent?"
      description={`You are about to delete "${agentName}". This action cannot be undone.`}
      isLoading={isLoading}
      isLoadingRelated={isLoadingRelated}
      inputTestId="cascade-archive-confirm-input"
      confirmTestId="cascade-archive-confirm-button"
      consequences={[
        { label: "Workflows", action: "archived", items: relatedWorkflow ? [relatedWorkflow] : [] },
      ]}
    />
  );
}
