import {
  type AllTraceMappingSources,
  type DatasetRecordEntry,
  mapTraceToDatasetEntry,
  type MappingState,
  SERVER_ONLY_TRACE_SOURCES,
  TRACE_EXPANSIONS,
  TRACE_MAPPINGS,
} from "@langwatch/dataset-contract";
import type { StudioWorkflow } from "@langwatch/workflow-contract";

export type TraceMappingSource = keyof typeof TRACE_MAPPINGS;
export type TraceExpansion = keyof typeof TRACE_EXPANSIONS;
export type TraceMappingDefinition = (typeof TRACE_MAPPINGS)[TraceMappingSource];

/** Trace field options for the threads sub-field selector, excluding thread sources themselves. */
export const THREAD_SUB_FIELD_OPTIONS = Object.keys(TRACE_MAPPINGS)
  .filter((key) => key !== "threads" && key !== "threads_until_current")
  .map((key) => ({ label: key, value: key }));

/** The sources a column can read from the trace it maps, in the order the picker offers them. */
export const CURRENT_TRACE_SOURCES = [
  ...SERVER_ONLY_TRACE_SOURCES,
  ...Object.keys(TRACE_MAPPINGS).filter(
    (key) => key !== "threads" && key !== "threads_until_current" && key !== "thread_id",
  ),
];

/** The sources a column can read from the trace's conversation. */
export const CURRENT_THREAD_SOURCES = ["thread_id", "threads_until_current", "threads"];

const MAPPABLE_SOURCES: readonly string[] = [
  ...SERVER_ONLY_TRACE_SOURCES,
  ...Object.keys(TRACE_MAPPINGS),
];

/** Whether a picked value names a source a column can map, or none. */
export function isTraceMappingSource(value: string): value is AllTraceMappingSources | "" {
  return value === "" || MAPPABLE_SOURCES.includes(value);
}

/**
 * What a dataset column of a given name is filled from by default: a source on
 * its own, or a source and one of its fields when the source alone would leave
 * the column empty.
 */
type DatasetInferredMapping = TraceMappingSource | { source: TraceMappingSource; key: string };

const DATASET_INFERRED_MAPPINGS_BY_NAME: Record<string, DatasetInferredMapping> = {
  trace_id: "trace_id",
  timestamp: "timestamp",
  input: "input",
  question: "input",
  user_input: "input",
  output: "output",
  answer: "output",
  response: "output",
  result: "output",
  expected_output: "output",
  total_cost: "metrics.total_cost",
  contexts: "contexts.string_list",
  spans: "spans",
  annotations: { source: "annotations", key: "ai_readable" },
};

/** The source half of an inferred mapping, which is all the workflow edges match on. */
const inferredMappingSource = (inferred: DatasetInferredMapping): TraceMappingSource =>
  typeof inferred === "string" ? inferred : inferred.source;

export type KeyOption = { key: string; label: string };

export type TraceMappingEntry = Extract<MappingState["mapping"][string], { type?: "trace" }>;

export type LocalTraceMappingState = {
  mapping: Record<string, TraceMappingEntry>;
  expansions: Set<TraceExpansion>;
};

/** How a column of this name is filled before anyone touches the mapping. */
function inferredMappingFor(columnName: string): TraceMappingEntry {
  const inferred = DATASET_INFERRED_MAPPINGS_BY_NAME[columnName];
  if (!inferred) return { source: "", selectedFields: [] };
  if (typeof inferred === "string") return { source: inferred, selectedFields: [] };
  return { source: inferred.source, key: inferred.key, selectedFields: [] };
}

/** Every column name whose inferred mapping reads from each source. */
const COLUMN_NAMES_BY_INFERRED_SOURCE = Object.entries(DATASET_INFERRED_MAPPINGS_BY_NAME).reduce<
  Record<string, string[]>
>((acc, [key, inferred]) => {
  const value = inferredMappingSource(inferred);
  acc[value] = [...(acc[value] ?? []), key];
  return acc;
}, {});

function traceMappingEntryFor(
  mapping: MappingState["mapping"],
  name: string,
): TraceMappingEntry | undefined {
  const entry = mapping[name];
  return entry?.type === "thread" ? undefined : entry;
}

function updateTraceMappingEntry(
  entry: TraceMappingEntry | undefined,
  changes: Partial<Omit<TraceMappingEntry, "source">>,
): TraceMappingEntry {
  return { source: entry?.source ?? "", ...entry, ...changes };
}

/** A column's mapping, re-pointed at a new source with its key and fields cleared. */
export function remapTraceMappingSource({
  state,
  targetField,
  source,
  availableExpansions,
}: {
  state: LocalTraceMappingState;
  targetField: string;
  source: AllTraceMappingSources | "";
  availableExpansions: Set<TraceExpansion>;
}): LocalTraceMappingState {
  return {
    ...state,
    mapping: {
      ...state.mapping,
      [targetField]: { source, key: undefined, subkey: undefined, selectedFields: [] },
    },
    expansions: expansionsAfterMapping({
      expansions: state.expansions,
      targetMapping: traceMappingDefinitionFor(source),
      availableExpansions,
    }),
  };
}

/** One column's mapping entry changed in place. */
export function withTraceMappingChange({
  state,
  targetField,
  changes,
}: {
  state: LocalTraceMappingState;
  targetField: string;
  changes: Partial<Omit<TraceMappingEntry, "source">>;
}): LocalTraceMappingState {
  return {
    ...state,
    mapping: {
      ...state.mapping,
      [targetField]: updateTraceMappingEntry(state.mapping[targetField], changes),
    },
  };
}

/** One expansion switched on or off. */
export function withExpansion({
  state,
  expansion,
  isChecked,
}: {
  state: LocalTraceMappingState;
  expansion: TraceExpansion;
  isChecked: boolean;
}): LocalTraceMappingState {
  const expansions = isChecked
    ? new Set([...state.expansions, expansion])
    : new Set(Array.from(state.expansions).filter((x) => x !== expansion));
  return { ...state, expansions };
}

/**
 * Sources whose key dropdowns are expanded with the project's distinct field names from
 * the last 30 days (not just the names on the loaded trace), served by
 * getDistinctFieldNames / useProjectSpanNames.
 */
export const PROJECT_FIELD_NAME_SOURCES: string[] = ["spans", "metadata", "evaluations"];

/** Result subfields an evaluation always exposes (see the evaluations mapping). */
const DEFAULT_EVALUATION_SUBKEYS: KeyOption[] = [
  "passed",
  "score",
  "label",
  "details",
  "status",
  "error",
].map((key) => ({ key, label: key }));

/** Subfields every span exposes, for any span name. */
const DEFAULT_SPAN_SUBKEYS: KeyOption[] = ["input", "output", "params", "contexts"].map((key) => ({
  key,
  label: key,
}));

/** Placeholder shown while a source's project-wide names are still loading. */
export const FIELD_NAME_LOADING_LABEL: Record<string, string> = {
  spans: "Loading span names…",
  metadata: "Loading metadata keys…",
  evaluations: "Loading evaluations…",
  events: "Loading event types…",
};

/** Label for the "match everything" option at the top of a source's dropdown. */
export const FIELD_NAME_ANY_LABEL: Record<string, string> = {
  spans: "* (any span)",
  metadata: "* (all metadata)",
  evaluations: "* (any evaluation)",
  events: "* (any event)",
};

/** The mapping definition a source names, when it names one. */
export function traceMappingDefinitionFor(source: string): TraceMappingDefinition | undefined {
  const sources: Partial<Record<string, TraceMappingDefinition>> = TRACE_MAPPINGS;
  return source ? sources[source] : undefined;
}

/** Whether two expansion selections say the same thing. */
const sameExpansions = ({
  expansions,
  other,
}: {
  expansions: Set<TraceExpansion>;
  other: Set<TraceExpansion>;
}): boolean =>
  expansions.size === other.size && Array.from(expansions).every((key) => other.has(key));

/** The expansion a mapping definition can be normalised by, if any. */
function expansionOf(definition: TraceMappingDefinition | undefined): TraceExpansion | undefined {
  if (!definition || !("expandable_by" in definition)) return undefined;
  return definition.expandable_by || undefined;
}

/**
 * The expansions after a column is mapped to a new source: an expansion that is
 * on by default switches on when its source first makes it available.
 */
function expansionsAfterMapping({
  expansions,
  targetMapping,
  availableExpansions,
}: {
  expansions: Set<TraceExpansion>;
  targetMapping?: TraceMappingDefinition;
  availableExpansions: Set<TraceExpansion>;
}): Set<TraceExpansion> {
  const expandableBy = expansionOf(targetMapping);
  if (!expandableBy || availableExpansions.has(expandableBy)) return expansions;
  if (!TRACE_EXPANSIONS[expandableBy].enabledByDefault) return expansions;
  return new Set([...expansions, expandableBy]);
}

/** The expansions the mapped sources make available. */
export function availableExpansionsFor(
  mapping: Record<string, TraceMappingEntry>,
): Set<TraceExpansion> {
  return new Set(
    Object.values(mapping)
      .map((entry) => expansionOf(traceMappingDefinitionFor(entry.source)))
      .filter((x): x is TraceExpansion => x !== undefined),
  );
}

/** Dedupe {key,label} options by key, preserving first-seen order. */
export const dedupeKeyOptions = (options: KeyOption[]): KeyOption[] => {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.key)) return false;
    seen.add(option.key);
    return true;
  });
};

export type ProjectKeyOptions = Record<
  "spans" | "metadata" | "evaluations" | "events",
  KeyOption[]
>;

/**
 * A source's key options widened with every name the project produced in the
 * last 30 days, so a name that exists elsewhere in the project can be mapped.
 */
export function mergeProjectKeyOptions({
  source,
  baseOptions,
  projectOptions,
}: {
  source: string;
  baseOptions: KeyOption[];
  projectOptions: ProjectKeyOptions;
}): KeyOption[] {
  const forSource: Partial<Record<string, KeyOption[]>> = projectOptions;
  const extra = forSource[source] ?? [];
  if (extra.length === 0) return baseOptions;
  return dedupeKeyOptions([...baseOptions, ...extra]).toSorted((a, b) =>
    a.label.localeCompare(b.label),
  );
}

/** The subfields a column's key offers, or none for sources without subfields. */
export function subkeyOptionsFor({
  source,
  key,
  definition,
  computeSubkeys,
}: {
  source: string;
  key: string | undefined;
  definition: TraceMappingDefinition | undefined;
  computeSubkeys: (k: string) => KeyOption[];
}): KeyOption[] {
  if (!definition || !("subkeys" in definition)) return [];
  if (source === "threads" || source === "threads_until_current") return [];
  // Spans always expose the same subfields, for any span name — including
  // project-wide names not on the loaded trace, where discovery is empty.
  if (source === "spans") {
    return dedupeKeyOptions([...DEFAULT_SPAN_SUBKEYS, ...(key ? computeSubkeys(key) : [])]);
  }
  if (source === "evaluations" && key) {
    return dedupeKeyOptions([...DEFAULT_EVALUATION_SUBKEYS, ...computeSubkeys(key)]);
  }
  return computeSubkeys(key ?? "");
}

/** Whether any mapped column reads one of these sources. */
export const mapsAnySource = ({
  mapping,
  sources,
}: {
  mapping: Record<string, TraceMappingEntry>;
  sources: readonly string[];
}): boolean => Object.values(mapping).some((entry) => sources.includes(entry.source));

/**
 * The mapping state with every target field present: the entry already chosen
 * here, then the stored one, then the one inferred from the column's name.
 */
export function mappingStateWithDefaults({
  state,
  stored,
  targetFields,
  isInitialized,
}: {
  state: LocalTraceMappingState;
  stored: MappingState;
  targetFields: string[];
  isInitialized: boolean;
}): LocalTraceMappingState {
  return {
    mapping: Object.fromEntries(
      targetFields.map((name) => [
        name,
        state.mapping[name] ??
          traceMappingEntryFor(stored.mapping, name) ??
          inferredMappingFor(name),
      ]),
    ),
    // Only before the first pass do the stored expansions stand in. After it
    // the state is the whole truth, including the empty set: turning the last
    // expansion off is an answer, not an absence of one.
    expansions: isInitialized ? state.expansions : new Set(stored.expansions),
  };
}

/**
 * Whether the defaulted state says something the current one does not. A Set
 * stringifies as `{}`, so the expansions are compared on their own.
 */
export function mappingStateDiffers({
  state,
  next,
}: {
  state: LocalTraceMappingState;
  next: LocalTraceMappingState;
}): boolean {
  const current = Object.keys(state.mapping);
  const fieldsChanged =
    current.length !== Object.keys(next.mapping).length ||
    !Object.keys(next.mapping).every((field) => current.includes(field));
  return (
    fieldsChanged ||
    JSON.stringify(state.mapping) !== JSON.stringify(next.mapping) ||
    !sameExpansions({ expansions: state.expansions, other: next.expansions })
  );
}

export type WorkflowMappingTarget = {
  sourceOptions: Record<string, { label: string; fields: string[] }>;
  targetId: string;
  targetEdges: StudioWorkflow["edges"];
  setTargetEdges?: (edges: StudioWorkflow["edges"]) => void;
};

type WorkflowEdge = StudioWorkflow["edges"][number];

/** The first workflow output whose field a column's name suggests. */
function inferredWorkflowSource({
  sourceOptions,
  targetField,
}: {
  sourceOptions: WorkflowMappingTarget["sourceOptions"];
  targetField: string;
}): { source: string; sourceHandle: string } | undefined {
  const inferred = DATASET_INFERRED_MAPPINGS_BY_NAME[targetField];
  const candidates = [
    ...(inferred ? [inferredMappingSource(inferred)] : []),
    ...(COLUMN_NAMES_BY_INFERRED_SOURCE[targetField] ?? []),
  ].filter((x) => x);
  const matches = Object.entries(sourceOptions).flatMap(([source, { fields }]) => {
    const option = candidates.find((candidate) => fields.includes(candidate));
    return option ? [{ source, sourceHandle: `outputs.${option}` }] : [];
  });
  return matches.at(-1);
}

/**
 * The workflow's edges into this target: the existing ones whose source field
 * still exists, plus an inferred edge for every unconnected field.
 */
export function targetEdgesWithDefaults({
  dsl,
  targetFields,
  now,
}: {
  dsl: WorkflowMappingTarget;
  targetFields: string[];
  now: number;
}): StudioWorkflow["edges"] {
  const connected = new Set(dsl.targetEdges.map((edge) => edge.targetHandle?.split(".")[1] ?? ""));
  const kept = dsl.targetEdges.filter((edge) =>
    dsl.sourceOptions[edge.source]?.fields.includes(edge.sourceHandle?.split(".")[1] ?? ""),
  );
  const inferred = targetFields
    .filter((targetField) => !connected.has(targetField))
    .flatMap((targetField): WorkflowEdge[] => {
      const found = inferredWorkflowSource({ sourceOptions: dsl.sourceOptions, targetField });
      if (!found) return [];
      return [
        {
          id: `${now}-${targetField}`,
          source: found.source,
          sourceHandle: found.sourceHandle,
          target: dsl.targetId,
          targetHandle: `inputs.${targetField}`,
          type: "default",
        },
      ];
    });
  return [...kept, ...inferred];
}

export type MappableTrace = Parameters<typeof mapTraceToDatasetEntry>[0]["trace"];
export type AnnotationScoreOptions = Parameters<
  typeof mapTraceToDatasetEntry
>[0]["annotationScoreOptions"];

/**
 * The dataset rows the traces map to, with server-only columns filled from the
 * server's formatted digests.
 */
export function datasetEntriesFor({
  traces,
  mapping,
  expansions,
  annotationScoreOptions,
  allTraces,
  formattedDigests,
  now,
}: {
  traces: MappableTrace[];
  mapping: Record<string, TraceMappingEntry>;
  expansions: Set<TraceExpansion>;
  annotationScoreOptions: AnnotationScoreOptions;
  allTraces: MappableTrace[];
  formattedDigests: Record<string, string> | undefined;
  now: number;
}): DatasetRecordEntry[] {
  const formattedColumns = Object.entries(mapping)
    .filter(([, entry]) => entry.source === "formatted_trace")
    .map(([column]) => column);
  const rows = traces.flatMap((trace) =>
    mapTraceToDatasetEntry({ trace, mapping, expansions, annotationScoreOptions, allTraces }).map(
      (entry) => {
        if (!formattedDigests) return entry;
        for (const column of formattedColumns) {
          entry[column] = formattedDigests[trace.trace_id] ?? "";
        }
        return entry;
      },
    ),
  );
  return rows.map((entry, index) => ({ id: `${now}-${index}`, selected: true, ...entry }));
}
