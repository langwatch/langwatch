import { Box, Field, HStack, NativeSelect, Text, VStack } from "@chakra-ui/react";
import type { Monaco } from "@monaco-editor/react";
import { useEffect, useState } from "react";
import dynamic from "~/utils/compat/next-dynamic";
import { Switch } from "~/components/ui/switch";
import { FieldsFilters } from "~/components/filters/FieldsFilters";
import type { FilterParam } from "~/hooks/useFilterParams";
import {
  sanitizeTriggerFilters,
  triggerFiltersPermissiveSchema,
  type FilterField,
} from "~/server/filters/types";
import { api } from "~/utils/api";
import {
  CONDITIONS_JSON_SCHEMA,
  CONDITIONS_MODEL_URI,
  registerJsonSchema,
} from "../../editors/monacoSchemas";
import { useMonacoTheme } from "../../editors/useMonacoTheme";
import type { ConditionSource } from "../../logic/draftReducer";
import { SourceCard } from "../SourceCard";
import { SecondaryDrawerShell } from "./SecondaryDrawerShell";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

export interface FiltersDrawerResult {
  source: ConditionSource;
  filters: Partial<Record<FilterField, FilterParam>>;
  customGraphId: string | null;
}

/**
 * Conditions secondary drawer. Lets the author pick the trigger source
 * (trace data vs custom graph), then either configure trace filters
 * (visual + JSON code mode with a registered JSON Schema) or pick a
 * custom graph from a dropdown.
 */
export function FiltersSecondaryDrawer({
  open,
  source,
  filters,
  customGraphId,
  projectId,
  onSave,
  onCancel,
}: {
  open: boolean;
  source: ConditionSource;
  filters: Partial<Record<FilterField, FilterParam>>;
  customGraphId: string | null;
  projectId: string;
  onSave: (result: FiltersDrawerResult) => void;
  onCancel: () => void;
}) {
  const [localSource, setLocalSource] = useState<ConditionSource>(source);
  const [local, setLocal] = useState(filters);
  const [localCustomGraphId, setLocalCustomGraphId] = useState<string | null>(
    customGraphId,
  );
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState(JSON.stringify(filters, null, 2));
  const [codeError, setCodeError] = useState<string | null>(null);
  const theme = useMonacoTheme();

  useEffect(() => {
    if (open) {
      setLocalSource(source);
      setLocal(filters);
      setLocalCustomGraphId(customGraphId);
      setCode(JSON.stringify(filters, null, 2));
      setCodeError(null);
    }
  }, [open, source, filters, customGraphId]);

  const graphs = api.graphs.getAll.useQuery(
    { projectId },
    { enabled: open && localSource === "customGraph" && !!projectId },
  );

  const onToggleCode = (toCode: boolean) => {
    if (toCode) {
      setCode(JSON.stringify(local, null, 2));
    } else {
      try {
        const parsed = JSON.parse(code);
        const result = triggerFiltersPermissiveSchema.safeParse(parsed);
        if (!result.success) {
          setCodeError(result.error.errors[0]?.message ?? "Invalid filters");
          return;
        }
        const { sanitized } = sanitizeTriggerFilters(result.data);
        setLocal(sanitized as Partial<Record<FilterField, FilterParam>>);
        setCodeError(null);
      } catch {
        setCodeError("Invalid JSON syntax");
        return;
      }
    }
    setCodeMode(toCode);
  };

  const apply = () => {
    if (localSource === "customGraph") {
      onSave({
        source: "customGraph",
        filters: {},
        customGraphId: localCustomGraphId,
      });
      return;
    }
    if (codeMode) {
      try {
        const parsed = JSON.parse(code);
        const result = triggerFiltersPermissiveSchema.safeParse(parsed);
        if (!result.success) {
          setCodeError(result.error.errors[0]?.message ?? "Invalid filters");
          return;
        }
        const { sanitized } = sanitizeTriggerFilters(result.data);
        onSave({
          source: "trace",
          filters: sanitized as Partial<Record<FilterField, FilterParam>>,
          customGraphId: null,
        });
      } catch {
        setCodeError("Invalid JSON syntax");
      }
    } else {
      onSave({ source: "trace", filters: local, customGraphId: null });
    }
  };

  return (
    <SecondaryDrawerShell
      open={open}
      title="When"
      onClose={onCancel}
      onDone={apply}
      headerRight={
        localSource === "trace" ? (
          <>
            <Text textStyle="sm" color="fg.muted">
              Code
            </Text>
            <Switch
              checked={codeMode}
              onCheckedChange={({ checked }) => onToggleCode(checked)}
            />
          </>
        ) : null
      }
    >
      <Box mb={4}>
        <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={2}>
          Source
        </Text>
        <HStack gap={2}>
          <SourceCard
            active={localSource === "trace"}
            title="Trace data"
            description="Match on incoming traces using filter fields."
            onClick={() => setLocalSource("trace")}
          />
          <SourceCard
            active={localSource === "customGraph"}
            title="Custom graph"
            description="Fire when a custom-graph alert threshold is crossed."
            onClick={() => setLocalSource("customGraph")}
          />
        </HStack>
      </Box>
      {localSource === "customGraph" ? (
        <VStack align="stretch" gap={2}>
          <Field.Root>
            <Field.Label>Custom graph</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={localCustomGraphId ?? ""}
                onChange={(e) =>
                  setLocalCustomGraphId(e.target.value || null)
                }
              >
                <option value="">Select a graph…</option>
                {(graphs.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name ?? g.id}
                    {g.trigger ? " — already automated" : ""}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>
          <Text textStyle="xs" color="fg.muted">
            The automation fires when this custom graph's alert threshold is
            crossed. Configure thresholds from the analytics view.
          </Text>
        </VStack>
      ) : codeMode ? (
        <VStack align="stretch" gap={2}>
          <Box
            border="1px solid"
            borderColor={codeError ? "red.500" : "border"}
            borderRadius="md"
            overflow="hidden"
            height="500px"
            background={theme === "vs-dark" ? "#1e1e1e" : "white"}
          >
            <MonacoEditor
              height="100%"
              language="json"
              path={CONDITIONS_MODEL_URI}
              value={code}
              theme={theme}
              beforeMount={(monaco: Monaco) => {
                registerJsonSchema(
                  monaco,
                  CONDITIONS_MODEL_URI,
                  CONDITIONS_JSON_SCHEMA,
                );
              }}
              onChange={(v: string | undefined) => setCode(v ?? "{}")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: "on",
                automaticLayout: true,
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                tabSize: 2,
                padding: { top: 12 },
              }}
            />
          </Box>
          {codeError ? (
            <Text color="red.500" textStyle="sm">
              {codeError}
            </Text>
          ) : null}
        </VStack>
      ) : (
        <VStack align="stretch" gap={2}>
          <Text textStyle="xs" color="fg.muted">
            The automation fires when an incoming trace matches every
            condition you set below.
          </Text>
          <FieldsFilters
            filters={local as Record<FilterField, FilterParam>}
            setFilters={(next) => setLocal((prev) => ({ ...prev, ...next }))}
          />
        </VStack>
      )}
    </SecondaryDrawerShell>
  );
}
