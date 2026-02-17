import {
  Button,
  HStack,
  Input,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
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
import { Checkbox } from "../ui/checkbox";
import { SmallLabel } from "../SmallLabel";

const SUPPORTED_PARAMETERS = [
  { value: "temperature", label: "Temperature" },
  { value: "frequency_penalty", label: "Frequency Penalty" },
  { value: "presence_penalty", label: "Presence Penalty" },
  { value: "top_p", label: "Top P" },
  { value: "top_k", label: "Top K" },
  { value: "system_prompt", label: "System Prompt" },
  { value: "reasoning_effort", label: "Reasoning Effort" },
] as const;

const RESPONSE_FORMATS = [
  { value: "plain_text", label: "Plain Text" },
  { value: "json", label: "JSON" },
  { value: "json_object", label: "JSON Object" },
  { value: "tools", label: "Tools" },
] as const;

type AddCustomModelDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (entry: CustomModelEntry) => void;
};

/**
 * Dialog for adding a custom chat model with full metadata configuration.
 * Includes fields for Model ID, Display Name, Max Tokens, supported parameters,
 * response formats, and input types.
 */
export function AddCustomModelDialog({
  open,
  onClose,
  onSubmit,
}: AddCustomModelDialogProps) {
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [supportedParameters, setSupportedParameters] = useState<string[]>([]);
  const [responseFormats, setResponseFormats] = useState<string[]>([]);
  const [supportsImageInput, setSupportsImageInput] = useState(false);
  const [supportsFileInput, setSupportsFileInput] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = useCallback(() => {
    setModelId("");
    setDisplayName("");
    setMaxTokens("");
    setSupportedParameters([]);
    setResponseFormats([]);
    setSupportsImageInput(false);
    setSupportsFileInput(false);
    setErrors({});
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const toggleParameter = useCallback((param: string) => {
    setSupportedParameters((prev) =>
      prev.includes(param)
        ? prev.filter((p) => p !== param)
        : [...prev, param],
    );
  }, []);

  const toggleResponseFormat = useCallback((format: string) => {
    setResponseFormats((prev) =>
      prev.includes(format)
        ? prev.filter((f) => f !== format)
        : [...prev, format],
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
      responseFormats:
        responseFormats.length > 0 ? responseFormats : undefined,
      supportsImageInput: supportsImageInput || undefined,
      supportsFileInput: supportsFileInput || undefined,
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
    responseFormats,
    supportsImageInput,
    supportsFileInput,
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
                {SUPPORTED_PARAMETERS.map((param) => (
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
              <SmallLabel>Response Formats</SmallLabel>
              <Wrap gap={3}>
                {RESPONSE_FORMATS.map((format) => (
                  <Checkbox
                    key={format.value}
                    checked={responseFormats.includes(format.value)}
                    onCheckedChange={() => toggleResponseFormat(format.value)}
                    size="sm"
                  >
                    <Text fontSize="sm">{format.label}</Text>
                  </Checkbox>
                ))}
              </Wrap>
            </VStack>

            <VStack gap={1} align="stretch">
              <SmallLabel>Input Types</SmallLabel>
              <Wrap gap={3}>
                <Checkbox
                  checked={supportsImageInput}
                  onCheckedChange={() =>
                    setSupportsImageInput((prev) => !prev)
                  }
                  size="sm"
                >
                  <Text fontSize="sm">Images</Text>
                </Checkbox>
                <Checkbox
                  checked={supportsFileInput}
                  onCheckedChange={() =>
                    setSupportsFileInput((prev) => !prev)
                  }
                  size="sm"
                >
                  <Text fontSize="sm">Files</Text>
                </Checkbox>
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
