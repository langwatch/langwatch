import { TRACE_MAPPING_LABELS } from "@langwatch/dataset-contract";
import {
  Box,
  GridItem,
  HStack,
  NativeSelect,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";
import { Select as MultiSelect } from "chakra-react-select";
import { ArrowRight } from "react-feather";

import {
  type AnnotationScoreOptions,
  CURRENT_THREAD_SOURCES,
  CURRENT_TRACE_SOURCES,
  FIELD_NAME_ANY_LABEL,
  FIELD_NAME_LOADING_LABEL,
  isTraceMappingSource,
  type KeyOption,
  type LocalTraceMappingState,
  type MappableTrace,
  mergeProjectKeyOptions,
  PROJECT_FIELD_NAME_SOURCES,
  type ProjectKeyOptions,
  remapTraceMappingSource,
  subkeyOptionsFor,
  THREAD_SUB_FIELD_OPTIONS,
  type TraceExpansion,
  type TraceMappingDefinition,
  traceMappingDefinitionFor,
  type TraceMappingEntry,
  withTraceMappingChange,
  type WorkflowMappingTarget,
} from "../../../model/traces/mapping/traces-mapping.ts";

type UpdateMappingState = (
  callback: (state: LocalTraceMappingState) => LocalTraceMappingState,
) => void;

/** Where the project-wide names each key dropdown offers stand. */
export type ProjectKeyNames = {
  options: ProjectKeyOptions;
  fieldNamesLoading: boolean;
  eventTypesLoading: boolean;
};

/** The elbow that hangs a key or field picker under its source. */
function MappingElbow() {
  return (
    <Box
      width="16px"
      minWidth="16px"
      height="24px"
      border="2px solid"
      borderRadius="0 0 0 6px"
      borderColor="border.emphasized"
      borderTop={0}
      borderRight={0}
      marginLeft="12px"
    />
  );
}

function Arrow() {
  return (
    <GridItem>
      <ArrowRight style={{ flexShrink: 0 }} />
    </GridItem>
  );
}

/** The workflow output that feeds one target field. */
function WorkflowSourceSelect({
  dsl,
  targetField,
  index,
}: {
  dsl: WorkflowMappingTarget;
  targetField: string;
  index: number;
}) {
  const targetHandle = `inputs.${targetField}`;
  const current = dsl.targetEdges.find((edge) => edge.targetHandle === targetHandle);
  const isSingleSource = Object.keys(dsl.sourceOptions).length === 1;

  const onChange = (value: string) => {
    const [source, sourceGroup, sourceField] = value.split(".");
    dsl.setTargetEdges?.([
      ...dsl.targetEdges.filter((edge) => edge.targetHandle !== targetHandle),
      {
        id: `${nowInstant().epochMilliseconds}-${index}`,
        source: source ?? "",
        target: dsl.targetId,
        sourceHandle: `${sourceGroup}.${sourceField}`,
        targetHandle,
        type: "default",
      },
    ]);
  };

  return (
    <GridItem>
      <NativeSelect.Root width="full">
        <NativeSelect.Field
          value={current ? `${current.source}.${current.sourceHandle}` : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" aria-label="None"></option>
          {Object.entries(dsl.sourceOptions).map(([key, { label, fields }]) => {
            if (fields.length === 0) return null;
            const options = fields.map((field) => (
              <option key={field} value={`${key}.outputs.${field}`}>
                {field}
              </option>
            ));
            if (isSingleSource) return options;
            return (
              <optgroup key={key} label={label}>
                {options}
              </optgroup>
            );
          })}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </GridItem>
  );
}

/** The trace or thread source a column reads. */
function TraceSourceSelect({
  source,
  onChange,
}: {
  source: string;
  onChange: (source: TraceMappingEntry["source"]) => void;
}) {
  return (
    <NativeSelect.Root width="full" minWidth="260px">
      <NativeSelect.Field
        onChange={(e) => {
          if (isTraceMappingSource(e.target.value)) onChange(e.target.value);
        }}
        value={source}
      >
        <option value="" aria-label="None"></option>
        <optgroup label="Current Trace">
          {CURRENT_TRACE_SOURCES.map((key) => (
            <option key={key} value={key}>
              {TRACE_MAPPING_LABELS[key] ?? key}
            </option>
          ))}
        </optgroup>
        <optgroup label="Current Thread">
          {CURRENT_THREAD_SOURCES.map((key) => (
            <option key={key} value={key}>
              {TRACE_MAPPING_LABELS[key] ?? key}
            </option>
          ))}
        </optgroup>
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

/**
 * The searchable key dropdown: these lists can hold hundreds of names, so a
 * plain <select> is hard to scan. While project-wide names load it says so.
 */
function KeySelect({
  source,
  selectedKey,
  keyOptions,
  isLoading,
  onChange,
}: {
  source: string;
  selectedKey: string | undefined;
  keyOptions: KeyOption[];
  isLoading: boolean;
  onChange: (key: string) => void;
}) {
  const options = keyOptions.map((option) => ({ value: option.key, label: option.label }));
  const anyLabel = FIELD_NAME_ANY_LABEL[source] ?? "* (any)";
  return (
    <HStack align="start" width="full">
      <MappingElbow />
      <MultiSelect
        isDisabled={isLoading}
        isLoading={isLoading}
        options={options}
        value={options.find((option) => option.value === (selectedKey ?? "")) ?? null}
        onChange={(selected) => onChange(selected?.value ?? "")}
        placeholder={isLoading ? (FIELD_NAME_LOADING_LABEL[source] ?? "Loading…") : anyLabel}
        chakraStyles={{
          container: (base) => ({ ...base, width: "100%", minWidth: "260px" }),
          menu: (base) => ({ ...base, zIndex: 2 }),
        }}
      />
    </HStack>
  );
}

/** The field of the chosen key a column reads, or the whole object. */
function SubkeySelect({
  source,
  subkey,
  subkeys,
  onChange,
}: {
  source: string;
  subkey: string | undefined;
  subkeys: KeyOption[];
  onChange: (subkey: string) => void;
}) {
  return (
    <HStack align="start" width="full">
      <MappingElbow />
      <NativeSelect.Root width="full">
        <NativeSelect.Field onChange={(e) => onChange(e.target.value)} value={subkey}>
          <option value="">
            {source === "spans" ? "* (full span object)" : "* (full object)"}
          </option>
          {subkeys.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </HStack>
  );
}

/** Which fields of each of the thread's traces a thread column carries. */
function ThreadFieldsSelect({
  selectedFields,
  onChange,
}: {
  selectedFields: string[];
  onChange: (selectedFields: string[]) => void;
}) {
  return (
    <HStack align="start" width="full">
      <MappingElbow />
      <MultiSelect
        isMulti
        options={THREAD_SUB_FIELD_OPTIONS}
        value={selectedFields.map((field) => ({ label: `thread.traces.${field}`, value: field }))}
        onChange={(newValue) => onChange(newValue.map((v) => v.value))}
        placeholder="Select trace fields..."
        closeMenuOnSelect={false}
        hideSelectedOptions={false}
        chakraStyles={{
          container: (base) => ({ ...base, width: "100%", minWidth: "150px" }),
        }}
      />
    </HStack>
  );
}

/** Whether the key dropdown for this source still waits on a project-wide list. */
function isLoadingKeyNames({ source, names }: { source: string; names: ProjectKeyNames }): boolean {
  if (source === "events") return names.eventTypesLoading;
  return names.fieldNamesLoading && PROJECT_FIELD_NAME_SOURCES.includes(source);
}

/** The "match everything" entry plus every project-wide and trace name for this source. */
function keyOptionsFor({
  source,
  definition,
  traces,
  names,
}: {
  source: string;
  definition: TraceMappingDefinition | undefined;
  traces: MappableTrace[];
  names: ProjectKeyNames;
}): KeyOption[] {
  if (isLoadingKeyNames({ source, names }) || !definition || !("keys" in definition)) return [];
  return [
    { key: "", label: FIELD_NAME_ANY_LABEL[source] ?? "* (any)" },
    ...mergeProjectKeyOptions({
      source,
      baseOptions: definition.keys(traces),
      projectOptions: names.options,
    }),
  ];
}

/** Where one column's value comes from in the trace or its thread. */
function TraceSourceFields({
  targetField,
  entry,
  traces,
  annotationScoreOptions,
  names,
  availableExpansions,
  update,
}: {
  targetField: string;
  entry: TraceMappingEntry;
  traces: MappableTrace[];
  annotationScoreOptions: AnnotationScoreOptions;
  names: ProjectKeyNames;
  availableExpansions: Set<TraceExpansion>;
  update: UpdateMappingState;
}) {
  const { source, key, subkey } = entry;
  const definition = traceMappingDefinitionFor(source);
  const subkeys = subkeyOptionsFor({
    source,
    key,
    definition,
    computeSubkeys: (k) =>
      definition && "subkeys" in definition
        ? definition.subkeys(traces, k, { annotationScoreOptions })
        : [],
  });
  const change = (changes: Partial<Omit<TraceMappingEntry, "source">>) =>
    update((state) => withTraceMappingChange({ state, targetField, changes }));

  return (
    <GridItem>
      <VStack align="start" width="full" gap={2}>
        <TraceSourceSelect
          source={source}
          onChange={(next) =>
            update((state) =>
              remapTraceMappingSource({ state, targetField, source: next, availableExpansions }),
            )
          }
        />
        {definition && "keys" in definition && (
          <KeySelect
            source={source}
            selectedKey={key}
            keyOptions={keyOptionsFor({ source, definition, traces, names })}
            isLoading={isLoadingKeyNames({ source, names })}
            onChange={(next) => change({ key: next })}
          />
        )}
        {subkeys.length > 0 && (
          <SubkeySelect
            source={source}
            subkey={subkey}
            subkeys={subkeys}
            onChange={(next) => change({ subkey: next })}
          />
        )}
        {(source === "threads" || source === "threads_until_current") && (
          <ThreadFieldsSelect
            selectedFields={entry.selectedFields ?? []}
            onChange={(selectedFields) => change({ selectedFields })}
          />
        )}
      </VStack>
    </GridItem>
  );
}

/** One target field's row: the workflow source, the trace source, and the field's name. */
export function TracesMappingRow({
  targetField,
  index,
  dsl,
  traceSource,
}: {
  targetField: string;
  index: number;
  dsl?: WorkflowMappingTarget;
  traceSource?: Omit<Parameters<typeof TraceSourceFields>[0], "targetField">;
}) {
  return (
    <>
      {dsl && (
        <>
          <WorkflowSourceSelect dsl={dsl} targetField={targetField} index={index} />
          <Arrow />
        </>
      )}
      {traceSource && (
        <>
          <TraceSourceFields targetField={targetField} {...traceSource} />
          <Arrow />
        </>
      )}
      <GridItem>
        <Text flexShrink={0} whiteSpace="nowrap">
          {targetField}
        </Text>
      </GridItem>
    </>
  );
}
