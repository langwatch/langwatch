import { Box, Button, HStack, Input, Spacer, Text, VStack, Wrap } from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";
import type {
  CustomModelEntry,
  MultimodalInput,
  SupportedParameter,
} from "@langwatch/model-provider-contract";
import { customModelEntrySchema, multimodalInputValues } from "@langwatch/model-provider-contract";
import { HorizontalFormControl } from "@langwatch/design-system/horizontal-form-control";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { fieldErrorsFromZodIssues } from "../../model/zod-field-errors.ts";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@langwatch/design-system/dialog";

/**
 * Optional sampling parameters the popover renders. `max_tokens` is
 * intentionally absent — the numeric "Max Tokens" field elsewhere in this
 * dialog captures the model's hard ceiling instead.
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

function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((existing) => existing !== item) : [...list, item];
}

function optionalList<T>(list: T[]): T[] | undefined {
  return list.length > 0 ? list : undefined;
}

function fieldError(message: string | undefined) {
  if (!message) return undefined;

  return (
    <Text color="red.500" fontSize="xs">
      {message}
    </Text>
  );
}

type AddCustomModelDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (entry: CustomModelEntry) => void;
  /** When provided, the dialog opens in edit mode pre-filled with these values. */
  initialValues?: CustomModelEntry;
  /** Override DialogContent background (e.g. "bg.surface" for solid on onboarding). */
  dialogBackground?: string;
};

/**
 * Dialog for adding or editing a custom chat model with metadata configuration.
 * Includes fields for Model ID, Display Name, supported parameters,
 * and multimodal input types.
 */
export function AddCustomModelDialog({
  open,
  onClose,
  onSubmit,
  initialValues,
  dialogBackground,
}: AddCustomModelDialogProps) {
  const isEditing = !!initialValues;
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_TOKENS));
  const [supportedParameters, setSupportedParameters] = useState<SupportedParameter[]>([
    ...DEFAULT_PARAMETERS,
  ]);
  const [multimodalInputs, setMultimodalInputs] = useState<MultimodalInput[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const displayNameTouched = useRef(false);
  const initialized = useRef(false);

  // Pre-fill form when initialValues change (edit mode)
  const shouldPrefill = open && initialValues && !initialized.current;
  if (shouldPrefill) {
    initialized.current = true;
    setModelId(initialValues.modelId);
    setDisplayName(initialValues.displayName);
    setMaxTokens(String(initialValues.maxTokens ?? DEFAULT_MAX_TOKENS));
    setSupportedParameters([...(initialValues.supportedParameters ?? DEFAULT_PARAMETERS)]);
    setMultimodalInputs([...(initialValues.multimodalInputs ?? [])]);
    displayNameTouched.current = true;
  }

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
    initialized.current = false;
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const toggleParameter = useCallback((param: SupportedParameter) => {
    setSupportedParameters((prev) => toggleInList(prev, param));
  }, []);

  const toggleMultimodal = useCallback((input: MultimodalInput) => {
    setMultimodalInputs((prev) => toggleInList(prev, input));
  }, []);

  const handleSubmit = useCallback(() => {
    const parsedMaxTokens = parseInt(maxTokens, 10);

    const entry: CustomModelEntry = {
      modelId: modelId.trim(),
      displayName: displayName.trim(),
      mode: "chat",
      maxTokens: Number.isNaN(parsedMaxTokens) ? DEFAULT_MAX_TOKENS : parsedMaxTokens,
      supportedParameters: optionalList(supportedParameters),
      multimodalInputs: optionalList(multimodalInputs),
    };

    const result = customModelEntrySchema.safeParse(entry);
    if (!result.success) {
      setErrors(fieldErrorsFromZodIssues(result.error.issues));
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
    <DialogRoot open={open} onOpenChange={(e) => !e.open && handleClose()} size="md">
      <DialogContent {...(dialogBackground ? { background: dialogBackground } : {})}>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Model" : "Add Model"}</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack gap={0} align="stretch">
            <HorizontalFormControl
              label="Model ID"
              helper="Exactly as your provider specifies it, e.g. a fine-tune ID or deployment name"
              error={fieldError(errors.modelId)}
            >
              <Input
                placeholder="e.g. gpt-5-custom"
                value={modelId}
                onChange={(e) => handleModelIdChange(e.target.value)}
                aria-label="Model ID"
              />
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Display Name"
              helper="How this model appears in selectors across LangWatch"
              error={fieldError(errors.displayName)}
            >
              <Input
                placeholder="e.g. GPT-5 Custom"
                value={displayName}
                onChange={(e) => handleDisplayNameChange(e.target.value)}
                aria-label="Display Name"
              />
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Max Tokens"
              helper="Maximum number of output tokens the model supports"
              error={fieldError(errors.maxTokens)}
            >
              <Input
                type="number"
                placeholder="e.g. 8192"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                aria-label="Max Tokens"
              />
            </HorizontalFormControl>

            <Box
              role="group"
              aria-label="Supported Parameters"
              borderBottomWidth="1px"
              paddingY={5}
            >
              <HStack width="full" flexDirection={["column", "column", "row"]} gap={4}>
                <VStack align="start" gap={1} width="full">
                  <Text fontWeight="medium">Supported Parameters</Text>
                  <Text fontSize="13px" color="fg.muted">
                    Which sampling parameters this model accepts
                  </Text>
                </VStack>
                <Spacer />
                <Box minWidth={["full", "full", "50%"]}>
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
                </Box>
              </HStack>
            </Box>

            <Box role="group" aria-label="Multimodal Support" paddingY={5}>
              <HStack width="full" flexDirection={["column", "column", "row"]} gap={4}>
                <VStack align="start" gap={1} width="full">
                  <Text fontWeight="medium">Multimodal Support</Text>
                  <Text fontSize="13px" color="fg.muted">
                    Input types this model can process besides text
                  </Text>
                </VStack>
                <Spacer />
                <Box minWidth={["full", "full", "50%"]}>
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
                </Box>
              </HStack>
            </Box>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button colorPalette="orange" size="sm" onClick={handleSubmit}>
              {isEditing ? "Save" : "Add model"}
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
