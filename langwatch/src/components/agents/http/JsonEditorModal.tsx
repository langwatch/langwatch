import { Alert, Box, Button, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog } from "~/components/ui/dialog";

export type JsonEditorModalProps = {
  open: boolean;
  onClose: () => void;
  value: string;
  onSave: (value: string) => void;
  title?: string;
  fieldType?: string;
};

/**
 * Modal for editing JSON values with validation.
 */
export function JsonEditorModal({
  open,
  onClose,
  value,
  onSave,
  title = "Edit JSON",
  fieldType,
}: JsonEditorModalProps) {
  const [localValue, setLocalValue] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // Reset local value when modal opens
  useEffect(() => {
    if (open) {
      setLocalValue(formatJson(value));
      setError(null);
    }
  }, [open, value]);

  const handleChange = useCallback((newValue: string) => {
    setLocalValue(newValue);
    try {
      JSON.parse(newValue);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, []);

  const handleSave = useCallback(() => {
    try {
      // Validate and minify for storage
      JSON.parse(localValue);
      onSave(localValue);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, [localValue, onSave]);

  const handleClose = useCallback(() => {
    if (localValue !== formatJson(value)) {
      if (!window.confirm("Discard changes?")) {
        return;
      }
    }
    onClose();
  }, [localValue, value, onClose]);

  const placeholder = useMemo(() => getPlaceholder(fieldType), [fieldType]);

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && handleClose()}>
      <Dialog.Content minWidth="500px" maxWidth="700px">
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={3}>
            {error && (
              <Alert.Root status="error">
                <Alert.Indicator />
                <Alert.Content>
                  <Text fontSize="sm">{error}</Text>
                </Alert.Content>
              </Alert.Root>
            )}
            <Box
              as="textarea"
              value={localValue}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                handleChange(e.target.value)
              }
              placeholder={placeholder}
              fontFamily="mono"
              fontSize="13px"
              padding={3}
              minHeight="200px"
              borderRadius="md"
              border="1px solid"
              borderColor={error ? "red.300" : "gray.200"}
              resize="vertical"
              _focus={{
                outline: "none",
                borderColor: error ? "red.500" : "blue.500",
                boxShadow: error
                  ? "0 0 0 1px var(--chakra-colors-red-500)"
                  : "0 0 0 1px var(--chakra-colors-blue-500)",
              }}
            />
            <Text fontSize="xs" color="gray.500">
              Enter valid JSON. Press Cmd+S to save.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={handleSave}
            disabled={!!error}
          >
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function getPlaceholder(fieldType?: string): string {
  switch (fieldType) {
    case "list":
    case "list[str]":
      return '["item1", "item2"]';
    case "dict":
    case "json":
      return '{\n  "key": "value"\n}';
    default:
      return "Enter JSON...";
  }
}
