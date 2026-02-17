import {
  Button,
  HStack,
  Input,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";
import type { CustomModelEntry, SupportedParameter, MultimodalInput } from "../../server/modelProviders/customModel.schema";
import { customModelEntrySchema, multimodalInputValues } from "../../server/modelProviders/customModel.schema";
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

/**
 * Parameters shown in the dialog — only the ones we actually
 * render in LLMConfigPopover. Max tokens is handled separately
 * at the form level.
 */
const DIALOG_PARAMETERS: { value: SupportedParameter; label: string }[] = [
  { value: "temperature", label: "Temperature" },
  { value: "top_p", label: "Top P" },
  { value: "top_k", label: "Top K" },
  { value: "reasoning", label: "Reasoning" },
];

const DEFAULT_PARAMETERS: SupportedParameter[] = ["temperature"];
const DEFAULT_MAX_TOKENS = 8192;

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
 * Dialog for adding a custom chat model with metadata configuration.
 * Includes fields for Model ID, Display Name, supported parameters,
 * and multimodal input types.
 */
export function AddCustomModelDialog({
  open,
  onClose,
  onSubmit,
}: AddCustomModelDialogProps) {
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_TOKENS));
  const [supportedParameters, setSupportedParameters] = useState<SupportedParameter[]>([...DEFAULT_PARAMETERS]);
  const [multimodalInputs, setMultimodalInputs] = useState<MultimodalInput[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const displayNameTouched = useRef(false);

  const handleModelIdChange = useCallback((value: string) => {
    setModelId(value);
    if (!displayNameTouched.current) {
      setDisplayName(value);
    }
  }, []);

  const handleDisplayNameChange = useCallback((value: string) => {
    displayNameTouched.current = true;
    setDisplayName(value);
  }, []);

  const resetForm = useCallback(() => {
    setModelId("");
    setDisplayName("");
    setMaxTokens(String(DEFAULT_MAX_TOKENS));
    setSupportedParameters([...DEFAULT_PARAMETERS]);
    setMultimodalInputs([]);
    setErrors({});
    displayNameTouched.current = false;
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
    const parsedMaxTokens = parseInt(maxTokens, 10);

    const entry: CustomModelEntry = {
      modelId: modelId.trim(),
      displayName: displayName.trim(),
      mode: "chat",
      maxTokens: Number.isNaN(parsedMaxTokens) ? DEFAULT_MAX_TOKENS : parsedMaxTokens,
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
    >
      <DialogContent>
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
                onChange={(e) => handleModelIdChange(e.target.value)}
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
                onChange={(e) => handleDisplayNameChange(e.target.value)}
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
                placeholder="e.g. 8192"
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
                {DIALOG_PARAMETERS.map((param) => (
                  <Checkbox
                    key={param.value}
                    checked={supportedParameters.includes(param.value)}
                    onCheckedChange={() => toggleParameter(param.value)}
                    size="sm"
                  >
                    <Text fontSize="sm">{param.label}</Text>
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
