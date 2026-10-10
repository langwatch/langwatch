import { DeleteConfirmationDialog } from "@langwatch/design-system/delete-confirmation-dialog";

export type RelatedEntity = {
  id: string;
  name: string;
};

export type RelatedEntities = {
  workflows?: RelatedEntity[];
  evaluators?: RelatedEntity[];
  agents?: RelatedEntity[];
  monitors?: RelatedEntity[];
};

export function WorkflowCascadeArchiveDialog({
  open,
  onClose,
  onConfirm,
  isLoading = false,
  isLoadingRelated = false,
  entityType,
  entityName,
  relatedEntities,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  isLoadingRelated?: boolean;
  entityType: "workflow" | "evaluator" | "agent";
  entityName: string;
  relatedEntities: RelatedEntities;
}) {
  return (
    <DeleteConfirmationDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      closeOnConfirm={false}
      title={`Delete ${entityType}?`}
      description={`You are about to delete "${entityName}". This action cannot be undone.`}
      isLoading={isLoading}
      isLoadingRelated={isLoadingRelated}
      inputTestId="cascade-archive-confirm-input"
      confirmTestId="cascade-archive-confirm-button"
      consequences={[
        { label: "Workflows", action: "archived", items: relatedEntities.workflows ?? [] },
        { label: "Evaluators", action: "archived", items: relatedEntities.evaluators ?? [] },
        { label: "Agents", action: "archived", items: relatedEntities.agents ?? [] },
        { label: "Online Evaluations", action: "deleted", items: relatedEntities.monitors ?? [] },
      ]}
    />
  );
}
