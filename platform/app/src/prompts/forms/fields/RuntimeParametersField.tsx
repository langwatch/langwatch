import { Button, HStack, Input, Spacer, Text, VStack } from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { PromptConfigFormValues } from "~/prompts/types";
import { displayValue, serializeValue } from "@langwatch/design-system/json-value-text";

type ParameterEntry = { id: string; key: string; value: string };

// Stable, unique row ids so React keys don't shift when rows are added/removed
// (using the array index would mis-associate input state/focus on removal).
let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `param-row-${rowIdCounter}`;
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
    id: nextRowId(),
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

  // Tracks the record we last reconciled with the form, so the sync effect can
  // detect *external* changes (e.g. loading a different version) without
  // depending on `entries` — reading `entries` there would be a stale closure.
  const lastRecordJsonRef = useRef(
    JSON.stringify((parameters as Record<string, unknown>) ?? {}),
  );

  useEffect(() => {
    const incoming = (parameters as Record<string, unknown>) ?? {};
    const incomingJson = JSON.stringify(incoming);
    if (incomingJson !== lastRecordJsonRef.current) {
      lastRecordJsonRef.current = incomingJson;
      setEntries(recordToEntries(incoming));
    }
  }, [parameters]);

  const syncToForm = useCallback(
    (newEntries: ParameterEntry[]) => {
      setEntries(newEntries);
      const record = entriesToRecord(newEntries);
      lastRecordJsonRef.current = JSON.stringify(record);
      methods.setValue("version.parameters", record, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [methods],
  );

  const handleAdd = () => {
    setEntries((prev) => [...prev, { id: nextRowId(), key: "", value: "" }]);
  };

  const handleRemove = (index: number) => {
    syncToForm(entries.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, field: "key" | "value", newValue: string) => {
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
        <Text fontSize="xs" fontWeight="bold" textTransform="uppercase" color="fg.muted">
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
            <HStack key={entry.id} gap={2} width="full">
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
              <Tooltip content="Remove parameter" positioning={{ placement: "top" }}>
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
