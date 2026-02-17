import {
  Button,
  HStack,
  Input,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import { useCallback, useState } from "react";
import type { CustomModelEntry, SupportedParameter, MultimodalInput } from "../../server/modelProviders/customModel.schema";
import { customModelEntrySchema, supportedParameterValues, multimodalInputValues } from "../../server/modelProviders/customModel.schema";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../ui/dialog";
import { Checkbox } from "../ui/checkbox";
import { SmallLabel } from "../SmallLabel";

const PARAMETER_LABELS: Record<SupportedParameter, string> = {
  temperature: "Temperature",
  max_tokens: "Max Tokens",
  top_p: "Top P",
  frequency_penalty: "Frequency Penalty",
  presence_penalty: "Presence Penalty",
  top_k: "Top K",
  min_p: "Min P",
  repetition_penalty: "Repetition Penalty",
  seed: "Seed",
  reasoning: "Reasoning",
  verbosity: "Verbosity",
};

const MULTIMODAL_LABELS: Record<MultimodalInput, string> = {
  image: "Images",
  file: "Files",
  audio: "Audio",
};

type AddCustomModelDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (entry: CustomModelEntry) => void;
};

/**
 * Dialog for adding a custom chat model with full metadata configuration.
 * Includes fields for Model ID, Display Name, Max Tokens, supported parameters,
 * and multimodal input types.
 */
export function AddCustomModelDialog({
  open,
  onClose,
  onSubmit,
}: AddCustomModelDialogProps) {
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [supportedParameters, setSupportedParameters] = useState<SupportedParameter[]>([]);
  const [multimodalInputs, setMultimodalInputs] = useState<MultimodalInput[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = useCallback(() => {
    setModelId("");
    setDisplayName("");
    setMaxTokens("");
    setSupportedParameters([]);
    setMultimodalInputs([]);
    setErrors({});
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const toggleParameter = useCallback((param: SupportedParameter) => {
    setSupportedParameters((prev) =>
      prev.includes(param)
        ? prev.filter((p) => p !== param)
        : [...prev, param],
    );
  }, []);

  const toggleMultimodal = useCallback((input: MultimodalInput) => {
    setMultimodalInputs((prev) =>
      prev.includes(input)
        ? prev.filter((i) => i !== input)
        : [...prev, input],
    );
  }, []);

  const handleSubmit = useCallback(() => {
    const parsedMaxTokens = maxTokens.trim()
      ? Number(maxTokens.trim())
      : null;

    const entry: CustomModelEntry = {
      modelId: modelId.trim(),
      displayName: displayName.trim(),
      mode: "chat",
      maxTokens:
        parsedMaxTokens !== null && !isNaN(parsedMaxTokens)
          ? parsedMaxTokens
          : null,
      supportedParameters:
        supportedParameters.length > 0 ? supportedParameters : undefined,
      multimodalInputs:
        multimodalInputs.length > 0 ? multimodalInputs : undefined,
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
  }, [
    modelId,
    displayName,
    maxTokens,
    supportedParameters,
    multimodalInputs,
    onSubmit,
    onClose,
    resetForm,
  ]);

  return (
    <DialogRoot
      open={open}
      onOpenChange={(e) => !e.open && handleClose()}
      size="lg"
      closeOnInteractOutside={false}
    >
      <DialogContent positionerProps={{ zIndex: 1502 }}>
        <DialogHeader>
          <DialogTitle>Add Model</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack gap={4} align="stretch">
            <VStack gap={1} align="stretch">
              <SmallLabel>Model ID</SmallLabel>
              <Input
                placeholder="e.g. gpt-5-custom"
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
                placeholder="e.g. GPT-5 Custom"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-label="Display Name"
              />
              {errors.displayName && (
                <SmallLabel color="red.500">{errors.displayName}</SmallLabel>
              )}
            </VStack>

            <VStack gap={1} align="stretch">
              <SmallLabel>Max Tokens</SmallLabel>
              <Input
                type="number"
                placeholder="e.g. 4096"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                aria-label="Max Tokens"
              />
              {errors.maxTokens && (
                <SmallLabel color="red.500">{errors.maxTokens}</SmallLabel>
              )}
            </VStack>

            <VStack gap={1} align="stretch">
              <SmallLabel>Supported Parameters</SmallLabel>
              <Wrap gap={3}>
                {supportedParameterValues.map((param) => (
                  <Checkbox
                    key={param}
                    checked={supportedParameters.includes(param)}
                    onCheckedChange={() => toggleParameter(param)}
                    size="sm"
                  >
                    <Text fontSize="sm">{PARAMETER_LABELS[param]}</Text>
                  </Checkbox>
                ))}
              </Wrap>
            </VStack>

            <VStack gap={1} align="stretch">
              <SmallLabel>Multimodal Support</SmallLabel>
              <Wrap gap={3}>
                {multimodalInputValues.map((input) => (
                  <Checkbox
                    key={input}
                    checked={multimodalInputs.includes(input)}
                    onCheckedChange={() => toggleMultimodal(input)}
                    size="sm"
                  >
                    <Text fontSize="sm">{MULTIMODAL_LABELS[input]}</Text>
                  </Checkbox>
                ))}
              </Wrap>
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
