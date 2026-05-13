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
import { runtimeConfigSchema } from "~/prompts/schemas/field-schemas";
import type { PromptConfigFormValues } from "~/prompts/types";

const formatConfig = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

export function RuntimeConfigField() {
  const methods = useFormContext<PromptConfigFormValues>();
  const config = useWatch({ control: methods.control, name: "version.config" });
  const error = methods.formState.errors.version?.config;
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState(formatConfig(config));

  const formattedConfig = useMemo(() => formatConfig(config), [config]);

  useEffect(() => {
    setLocalValue(formattedConfig);
  }, [formattedConfig]);

  const handleChange = (value: string) => {
    setLocalValue(value);

    try {
      const parsed = JSON.parse(value || "{}");
      const validation = runtimeConfigSchema.safeParse(parsed);
      if (!validation.success) {
        methods.setError("version.config", {
          type: "manual",
          message: "Config must be a JSON object",
        });
        return;
      }

      methods.clearErrors("version.config");
      methods.setValue("version.config", validation.data, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } catch {
      methods.setError("version.config", {
        type: "manual",
        message: "Config must be valid JSON",
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
              <Text fontWeight="medium">Runtime Config</Text>
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
              aria-label="Runtime Config JSON"
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

export function RuntimeConfigReadonly({ value }: { value: Record<string, unknown> }) {
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
      data-testid="runtime-config-readonly"
    >
      {formatConfig(value)}
    </Box>
  );
}
