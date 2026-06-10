import {
  Button,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Tooltip } from "~/components/ui/tooltip";
import type { PromptConfigFormValues } from "~/prompts/types";

type ParameterEntry = { id: string; key: string; value: string };

// Stable, unique row ids so React keys don't shift when rows are added/removed
// (using the array index would mis-associate input state/focus on removal).
let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `param-row-${rowIdCounter}`;
}

/**
 * Parse the text in a value input back into a JSON value.
 *
 * Parameters are not UI-only — they are also written via REST/tRPC/SDK with
 * real JSON (numbers, booleans, objects, and strings). To round-trip
 * losslessly, the text is interpreted as JSON when it parses, otherwise it is
 * kept as a plain string. This is the exact inverse of {@link displayValue}:
 * a string that looks like another type is quoted on display, so it parses
 * back to a string here.
 */
function serializeValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Render a stored JSON value as editable text.
 *
 * Inverse of {@link serializeValue}: a string whose contents would otherwise
 * parse as another JSON type (e.g. "007", "true", "{}") is shown quoted so it
 * cannot be silently coerced on the next edit; plain strings are shown bare.
 */
function displayValue(v: unknown): string {
  if (typeof v === "string") {
    try {
      JSON.parse(v);
      // Bare text would re-parse as a non-string → quote to disambiguate.
      return JSON.stringify(v);
    } catch {
      return v;
    }
  }
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
