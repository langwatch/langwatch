import { Button, Circle, Heading, HStack, Spacer } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";

export const REMOVE_EVALUATOR_LABEL = "Remove evaluator";

/**
 * The button that takes the attachment off, when the editor is open on one,
 * and the spacer that pins it to its own side of the footer.
 */
function FooterRemoveArea({
  onRemove,
  hasSpacer,
}: {
  onRemove: (() => void) | undefined;
  hasSpacer: boolean;
}) {
  if (!onRemove) return null;
  return (
    <>
      <Button
        variant="ghost"
        colorPalette="red"
        size="sm"
        onClick={onRemove}
        data-testid="evaluator-remove-button"
      >
        {REMOVE_EVALUATOR_LABEL}
      </Button>
      {hasSpacer && <Spacer />}
    </>
  );
}

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
  /** Called when the attachment is taken off. Renders a "Remove evaluator" button when present. */
  onRemove?: (() => void) | undefined;
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
  onRemove,
}: EvaluatorEditorActionsProps) {
  if (mode === "local") {
    return (
      <HStack width="full">
        <FooterRemoveArea onRemove={onRemove} hasSpacer={false} />
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
    <HStack gap={3} width={onRemove ? "full" : undefined}>
      <FooterRemoveArea onRemove={onRemove} hasSpacer={true} />
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
