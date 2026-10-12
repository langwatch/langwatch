import { Dialog } from "@langwatch/design-system/dialog";
import { Input, VStack } from "@langwatch/design-system/primitives";
import { SmallLabel } from "@langwatch/design-system/small-label";
import type { CustomModelEntry } from "@langwatch/model-provider-contract";
import { customModelEntrySchema } from "@langwatch/model-provider-contract";
import { useCallback, useRef, useState } from "react";

import { fieldErrorsFromZodIssues } from "../../model/zod-field-errors.ts";

type AddCustomEmbeddingsModelDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (entry: CustomModelEntry) => void;
  /** When provided, the dialog opens in edit mode pre-filled with these values. */
  initialValues?: CustomModelEntry;
  /** `card` keeps the card ground the onboarding page gives its dialogs. */
  ground?: "card";
};

/**
 * Dialog for adding or editing a custom embeddings model.
 * Only collects Model ID and Display Name since embeddings models
 * do not need parameter configuration.
 */
export function AddCustomEmbeddingsModelDialog({
  open,
  onClose,
  onSubmit,
  initialValues,
  ground,
}: AddCustomEmbeddingsModelDialogProps) {
  const isEditing = !!initialValues;
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const initialized = useRef(false);

  // Pre-fill form when initialValues change (edit mode)
  const shouldPrefill = open && initialValues && !initialized.current;
  if (shouldPrefill) {
    initialized.current = true;
    setModelId(initialValues.modelId);
    setDisplayName(initialValues.displayName);
  }

  const resetForm = useCallback(() => {
    setModelId("");
    setDisplayName("");
    setErrors({});
    initialized.current = false;
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(() => {
    const entry: CustomModelEntry = {
      modelId: modelId.trim(),
      displayName: displayName.trim(),
      mode: "embedding",
    };

    const result = customModelEntrySchema.safeParse(entry);
    if (!result.success) {
      setErrors(fieldErrorsFromZodIssues(result.error.issues));
      return;
    }

    onSubmit(result.data);
    resetForm();
    onClose();
  }, [modelId, displayName, onSubmit, onClose, resetForm]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={isEditing ? "Edit embeddings model" : "Add embeddings model"}
      ground={ground}
      onSubmit={handleSubmit}
      primaryAction={{ label: isEditing ? "Save" : "Add model", type: "submit" }}
    >
      <VStack gap={4} align="stretch">
        <VStack gap={1} align="stretch">
          <SmallLabel>Model ID</SmallLabel>
          <Input
            placeholder="e.g. text-embedding-custom"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            aria-label="Model ID"
          />
          {errors.modelId && <SmallLabel color="red.fg">{errors.modelId}</SmallLabel>}
        </VStack>
        <VStack gap={1} align="stretch">
          <SmallLabel>Display Name</SmallLabel>
          <Input
            placeholder="e.g. Custom Embedding Model"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-label="Display Name"
          />
          {errors.displayName && <SmallLabel color="red.fg">{errors.displayName}</SmallLabel>}
        </VStack>
      </VStack>
    </Dialog>
  );
}
