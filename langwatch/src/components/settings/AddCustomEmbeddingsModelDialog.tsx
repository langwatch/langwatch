import { Button, HStack, Input, VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import type { CustomModelEntry } from "../../server/modelProviders/customModel.schema";
import { customModelEntrySchema } from "../../server/modelProviders/customModel.schema";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../ui/dialog";
import { SmallLabel } from "../SmallLabel";

type AddCustomEmbeddingsModelDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (entry: CustomModelEntry) => void;
};

/**
 * Dialog for adding a custom embeddings model.
 * Only collects Model ID and Display Name since embeddings models
 * do not need parameter configuration.
 */
export function AddCustomEmbeddingsModelDialog({
  open,
  onClose,
  onSubmit,
}: AddCustomEmbeddingsModelDialogProps) {
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = useCallback(() => {
    setModelId("");
    setDisplayName("");
    setErrors({});
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
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (field) {
          fieldErrors[String(field)] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    onSubmit(result.data);
    resetForm();
    onClose();
  }, [modelId, displayName, onSubmit, onClose, resetForm]);

  return (
    <DialogRoot open={open} onOpenChange={(e) => !e.open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Embeddings Model</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack gap={4} align="stretch">
            <VStack gap={1} align="stretch">
              <SmallLabel>Model ID</SmallLabel>
              <Input
                placeholder="e.g. text-embedding-custom"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                aria-label="Model ID"
              />
              {errors.modelId && (
                <SmallLabel color="red.500">{errors.modelId}</SmallLabel>
              )}
            </VStack>
            <VStack gap={1} align="stretch">
              <SmallLabel>Display Name</SmallLabel>
              <Input
                placeholder="e.g. Custom Embedding Model"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-label="Display Name"
              />
              {errors.displayName && (
                <SmallLabel color="red.500">{errors.displayName}</SmallLabel>
              )}
            </VStack>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              size="sm"
              onClick={handleSubmit}
            >
              Create model
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
