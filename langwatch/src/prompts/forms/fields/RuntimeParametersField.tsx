import {
  Alert,
  Box,
  Button,
  Collapsible,
  HStack,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { runtimeParametersSchema } from "~/prompts/schemas/field-schemas";
import type { PromptConfigFormValues } from "~/prompts/types";

const formatParameters = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

export function RuntimeParametersField() {
  const methods = useFormContext<PromptConfigFormValues>();
  const parameters = useWatch({ control: methods.control, name: "version.parameters" });
  const error = methods.formState.errors.version?.parameters;
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState(formatParameters(parameters));

  const formattedParameters = useMemo(() => formatParameters(parameters), [parameters]);

  useEffect(() => {
    setLocalValue(formattedParameters);
  }, [formattedParameters]);

  const handleChange = (value: string) => {
    setLocalValue(value);

    try {
      const parsed = JSON.parse(value || "{}");
      const validation = runtimeParametersSchema.safeParse(parsed);
      if (!validation.success) {
        methods.setError("version.parameters", {
          type: "manual",
          message: "Parameters must be a JSON object",
        });
        return;
      }

      methods.clearErrors("version.parameters");
      methods.setValue("version.parameters", validation.data, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } catch {
      methods.setError("version.parameters", {
        type: "manual",
        message: "Parameters must be valid JSON",
      });
    }
  };

  return (
    <Collapsible.Root open={open} onOpenChange={(details) => setOpen(details.open)} width="full">
      <VStack width="full" align="stretch" gap={2}>
        <Collapsible.Trigger asChild>
          <Button variant="ghost" justifyContent="start" paddingX={0}>
            <HStack gap={2}>
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Text fontWeight="medium">Runtime Parameters</Text>
            </HStack>
          </Button>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <VStack align="stretch" gap={2}>
            {typeof error?.message === "string" && (
              <Alert.Root colorPalette="red">
                <Alert.Content>
                  <Alert.Title>{error.message}</Alert.Title>
                </Alert.Content>
              </Alert.Root>
            )}
            <Textarea
              aria-label="Runtime Parameters JSON"
              value={localValue}
              onChange={(event) => handleChange(event.target.value)}
              minHeight="160px"
              resize="vertical"
              fontFamily="monospace"
              fontSize="13px"
              lineHeight="1.5"
            />
          </VStack>
        </Collapsible.Content>
      </VStack>
    </Collapsible.Root>
  );
}

export function RuntimeParametersReadonly({ value }: { value: Record<string, unknown> }) {
  return (
    <Box
      as="pre"
      background="bg.muted"
      borderRadius="md"
      padding={3}
      overflow="auto"
      fontSize="13px"
      lineHeight="1.5"
      fontFamily="monospace"
      whiteSpace="pre-wrap"
      width="full"
      height="full"
      data-testid="runtime-parameters-readonly"
    >
      {formatParameters(value)}
    </Box>
  );
}
