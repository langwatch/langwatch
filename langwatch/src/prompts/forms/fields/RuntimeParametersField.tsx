import {
  Button,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Tooltip } from "~/components/ui/tooltip";
import type { PromptConfigFormValues } from "~/prompts/types";

type ParameterEntry = { key: string; value: string };

function serializeValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed !== "" && !isNaN(Number(trimmed))) return Number(trimmed);
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object") return parsed;
  } catch {
    // not JSON — treat as string
  }
  return raw;
}

function displayValue(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function entriesToRecord(entries: ParameterEntry[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.key.trim()) {
      result[entry.key.trim()] = serializeValue(entry.value);
    }
  }
  return result;
}

function recordToEntries(record: Record<string, unknown>): ParameterEntry[] {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: displayValue(value),
  }));
}

export function RuntimeParametersField() {
  const methods = useFormContext<PromptConfigFormValues>();
  const parameters = useWatch({
    control: methods.control,
    name: "version.parameters",
  });

  const [entries, setEntries] = useState<ParameterEntry[]>(() =>
    recordToEntries((parameters as Record<string, unknown>) ?? {}),
  );

  useEffect(() => {
    const incomingRecord = (parameters as Record<string, unknown>) ?? {};
    const current = entriesToRecord(entries);
    if (JSON.stringify(current) !== JSON.stringify(incomingRecord)) {
      setEntries(recordToEntries(incomingRecord));
    }
  }, [parameters]);

  const syncToForm = useCallback(
    (newEntries: ParameterEntry[]) => {
      setEntries(newEntries);
      methods.setValue("version.parameters", entriesToRecord(newEntries), {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [methods],
  );

  const handleAdd = () => {
    const newEntries = [...entries, { key: "", value: "" }];
    setEntries(newEntries);
  };

  const handleRemove = (index: number) => {
    syncToForm(entries.filter((_, i) => i !== index));
  };

  const handleUpdate = (
    index: number,
    field: "key" | "value",
    newValue: string,
  ) => {
    const updated = [...entries];
    const entry = updated[index];
    if (entry) {
      updated[index] = { ...entry, [field]: newValue };
      syncToForm(updated);
    }
  };

  return (
    <VStack align="stretch" gap={3} width="full">
      <HStack width="full">
        <Text
          fontSize="xs"
          fontWeight="bold"
          textTransform="uppercase"
          color="fg.muted"
        >
          Parameters
        </Text>
        <Spacer />
        <Button
          size="xs"
          variant="outline"
          onClick={handleAdd}
          data-testid="add-parameter-button"
        >
          <Plus size={14} />
          Add
        </Button>
      </HStack>

      {entries.length === 0 ? (
        <Text fontSize="13px" color="fg.subtle">
          No parameters defined
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {entries.map((entry, index) => (
            <HStack key={index} gap={2} width="full">
              <Input
                value={entry.key}
                onChange={(e) => handleUpdate(index, "key", e.target.value)}
                placeholder="key"
                size="sm"
                width="120px"
                flexShrink={0}
                fontFamily="mono"
                fontSize="13px"
                data-testid={`param-key-${index}`}
              />
              <Text color="fg.subtle" fontSize="sm" flexShrink={0}>
                =
              </Text>
              <Input
                value={entry.value}
                onChange={(e) => handleUpdate(index, "value", e.target.value)}
                placeholder="value"
                size="sm"
                flex={1}
                minWidth={0}
                fontFamily="mono"
                fontSize="13px"
                variant="flushed"
                borderColor="border"
                data-testid={`param-value-${index}`}
              />
              <Tooltip
                content="Remove parameter"
                positioning={{ placement: "top" }}
              >
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="gray"
                  onClick={() => handleRemove(index)}
                  flexShrink={0}
                  color="fg.subtle"
                  data-testid={`remove-param-${index}`}
                >
                  <X size={14} />
                </Button>
              </Tooltip>
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

export function RuntimeParametersReadonly({
  value,
}: {
  value: Record<string, unknown>;
}) {
  const entries = Object.entries(value);

  if (entries.length === 0) {
    return (
      <Text
        fontSize="13px"
        color="fg.subtle"
        textAlign="center"
        paddingY={6}
        data-testid="runtime-parameters-readonly"
      >
        No parameters defined
      </Text>
    );
  }

  return (
    <VStack
      align="stretch"
      gap={2}
      width="full"
      height="full"
      data-testid="runtime-parameters-readonly"
    >
      {entries.map(([key, val]) => (
        <HStack
          key={key}
          gap={3}
          paddingY={1.5}
          paddingX={3}
          borderRadius="md"
          background="bg.muted"
        >
          <Text
            fontFamily="monospace"
            fontSize="13px"
            fontWeight="semibold"
            color="fg.default"
            minWidth="120px"
          >
            {key}
          </Text>
          <Text
            fontFamily="monospace"
            fontSize="13px"
            color="fg.muted"
            wordBreak="break-all"
          >
            {displayValue(val)}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}
