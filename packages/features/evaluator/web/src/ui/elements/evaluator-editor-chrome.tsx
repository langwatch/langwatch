import { Button, Circle, Heading, HStack, Spacer } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";

export type EvaluatorEditorActionsProps = {
  mode: "local" | "persisted";
  isEditing: boolean;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isValid: boolean;
  isComparisonEditor?: boolean;
  saveButtonText?: string;
  onSave: () => void;
  onDiscard: () => void;
  onApply: () => void;
  onCancel: () => void;
};

/** Evaluator editor actions with all transport and navigation supplied by the host. */
export function EvaluatorEditorActions({
  mode,
  isEditing,
  hasUnsavedChanges,
  isSaving,
  isValid,
  isComparisonEditor = false,
  saveButtonText,
  onSave,
  onDiscard,
  onApply,
  onCancel,
}: EvaluatorEditorActionsProps) {
  if (mode === "local") {
    return (
      <HStack width="full">
        {hasUnsavedChanges && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDiscard}
            data-testid="evaluator-discard-button"
          >
            Discard
          </Button>
        )}
        <Spacer />
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={!isValid || isSaving}
          loading={isSaving}
          data-testid="evaluator-save-button"
        >
          Save
        </Button>
        <Button
          colorPalette="blue"
          size="sm"
          onClick={onApply}
          disabled={isComparisonEditor && (!isValid || isSaving)}
          data-testid="evaluator-apply-button"
        >
          Apply
        </Button>
      </HStack>
    );
  }

  return (
    <HStack gap={3}>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        colorPalette="green"
        onClick={onSave}
        disabled={!isValid || isSaving}
        loading={isSaving}
        data-testid="save-evaluator-button"
      >
        {saveButtonText ?? (isEditing ? "Save Changes" : "Create Evaluator")}
      </Button>
    </HStack>
  );
}

export type EvaluatorEditorHeadingProps = {
  title: string;
  showUnpublishedBadge: boolean;
};

export function EvaluatorEditorHeading({
  title,
  showUnpublishedBadge,
}: EvaluatorEditorHeadingProps) {
  return (
    <>
      <Heading>{title}</Heading>
      {showUnpublishedBadge && (
        <Tooltip
          content="Unpublished modifications"
          positioning={{ placement: "top" }}
          openDelay={0}
          showArrow
        >
          <Circle size="10px" bg="orange.400" />
        </Tooltip>
      )}
    </>
  );
}
