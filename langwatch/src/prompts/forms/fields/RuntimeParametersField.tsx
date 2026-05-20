import {
  Button,
  Collapsible,
  HStack,
  Input,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Tooltip } from "~/components/ui/tooltip";
import type { PromptConfigFormValues } from "~/prompts/types";

type ParameterEntry = { key: string; value: string };

function isSimpleValue(v: unknown): boolean {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    v === null
  );
}

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
  const [open, setOpen] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [entries, setEntries] = useState<ParameterEntry[]>(() =>
    recordToEntries((parameters as Record<string, unknown>) ?? {}),
  );

  useEffect(() => {
    const incoming = recordToEntries((parameters as Record<string, unknown>) ?? {});
    const current = entriesToRecord(entries);
    const incomingRecord = (parameters as Record<string, unknown>) ?? {};
    if (JSON.stringify(current) !== JSON.stringify(incomingRecord)) {
      setEntries(incoming);
    }
  }, [parameters]);

  const hasComplexValues = useMemo(
    () => entries.some((e) => !isSimpleValue(serializeValue(e.value))),
    [entries],
  );

  const paramCount = entries.filter((e) => e.key.trim()).length;

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

  const handleSwitchToJson = () => {
    setJsonDraft(JSON.stringify(parameters ?? {}, null, 2));
    setJsonError(null);
    setShowJsonEditor(true);
  };

  const handleJsonApply = () => {
    try {
      const parsed = JSON.parse(jsonDraft || "{}");
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        setJsonError("Must be a JSON object");
        return;
      }
      methods.setValue("version.parameters", parsed, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setJsonError(null);
      setShowJsonEditor(false);
    } catch {
      setJsonError("Invalid JSON");
    }
  };

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      width="full"
    >
      <VStack width="full" align="stretch" gap={2}>
        <Collapsible.Trigger asChild>
          <Button variant="ghost" justifyContent="start" paddingX={0}>
            <HStack gap={2}>
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Text fontWeight="medium">Runtime Parameters</Text>
              {paramCount > 0 && (
                <Text fontSize="xs" color="fg.muted">
                  ({paramCount})
                </Text>
              )}
            </HStack>
          </Button>
        </Collapsible.Trigger>
        <Collapsible.Content>
          {showJsonEditor ? (
            <VStack align="stretch" gap={2}>
              <Textarea
                aria-label="Runtime Parameters JSON"
                value={jsonDraft}
                onChange={(e) => {
                  setJsonDraft(e.target.value);
                  setJsonError(null);
                }}
                minHeight="120px"
                resize="vertical"
                fontFamily="monospace"
                fontSize="13px"
                lineHeight="1.5"
              />
              {jsonError && (
                <Text fontSize="xs" color="fg.error">
                  {jsonError}
                </Text>
              )}
              <HStack>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setShowJsonEditor(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="xs"
                  colorPalette="blue"
                  onClick={handleJsonApply}
                >
                  Apply JSON
                </Button>
              </HStack>
            </VStack>
          ) : (
            <VStack align="stretch" gap={3}>
              <HStack width="full">
                <Spacer />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={handleAdd}
                  data-testid="add-parameter-button"
                >
                  <Plus size={14} />
                  Add Parameter
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={handleSwitchToJson}
                  color="fg.muted"
                >
                  Edit as JSON
                </Button>
              </HStack>

              {entries.length === 0 ? (
                <Text
                  fontSize="13px"
                  color="fg.subtle"
                  textAlign="center"
                  paddingY={4}
                >
                  No parameters defined
                </Text>
              ) : (
                <VStack align="stretch" gap={2}>
                  {entries.map((entry, index) => (
                    <HStack key={index} gap={2}>
                      <Input
                        value={entry.key}
                        onChange={(e) =>
                          handleUpdate(index, "key", e.target.value)
                        }
                        placeholder="Key"
                        size="sm"
                        flex={1}
                        fontFamily="monospace"
                        fontSize="13px"
                        data-testid={`param-key-${index}`}
                      />
                      {!isSimpleValue(serializeValue(entry.value)) ||
                      hasComplexValues ? (
                        <Textarea
                          value={entry.value}
                          onChange={(e) =>
                            handleUpdate(index, "value", e.target.value)
                          }
                          placeholder="Value"
                          size="sm"
                          flex={2}
                          fontFamily="monospace"
                          fontSize="13px"
                          rows={2}
                          resize="vertical"
                          data-testid={`param-value-${index}`}
                        />
                      ) : (
                        <Input
                          value={entry.value}
                          onChange={(e) =>
                            handleUpdate(index, "value", e.target.value)
                          }
                          placeholder="Value"
                          size="sm"
                          flex={2}
                          fontFamily="monospace"
                          fontSize="13px"
                          data-testid={`param-value-${index}`}
                        />
                      )}
                      <Tooltip
                        content="Remove parameter"
                        positioning={{ placement: "top" }}
                      >
                        <Button
                          size="xs"
                          variant="ghost"
                          colorPalette="gray"
                          onClick={() => handleRemove(index)}
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
          )}
        </Collapsible.Content>
      </VStack>
    </Collapsible.Root>
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
