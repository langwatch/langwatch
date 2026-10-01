import type { DatasetActionParams, SavedTriggerRow } from "@langwatch/automation-contract";
import {
  type DatasetColumns,
  datasetColumnsSchema,
  mappingStateSchema,
} from "@langwatch/dataset-contract";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { Database } from "lucide-react";
import { useEffect } from "react";

import { TracesMapping } from "../../../../behavior/lent-peers.tsx";
import { useProjectDatasets } from "../../../../behavior/use-automation-reads.ts";
import { useAutomationHost } from "../../../../model/automation-host.ts";
import type {
  ClientDef,
  ConfigFormProps,
  SummaryIdentity,
} from "../../../../model/provider-types.ts";
import { keepDraftOnSubFlowReturn, announceSubFlowDeparture } from "../../behavior/sub-flow.ts";
import { useMappingEditsOnly } from "../../behavior/use-mapping-edits-only.ts";
import type { DatasetMapping, DatasetSlice, TraceMappingEntry } from "../../model/dataset-slice.ts";
import { DatasetSelector } from "../blocks/dataset-selector.tsx";

export type { DatasetSlice } from "../../model/dataset-slice.ts";

const EMPTY_MAPPING: DatasetMapping = { mapping: {}, expansions: [] };

/**
 * Obvious trace source for a dataset column by its lower-cased name,
 * mirroring the dataset-view mapping editor so authored triggers get the
 * same defaults; unlisted columns fall back to `metadata` (`sourceForColumn`).
 */
const INFERRED_SOURCE_BY_COLUMN_NAME: Record<string, string> = {
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
};

/** Derive one column's mapping entry. Known names map to their obvious trace
 *  source; anything else maps to the trace metadata field of the same name —
 *  a sensible, non-empty default rather than an unmapped (blank) column. */
function entryForColumn(name: string): TraceMappingEntry {
  const inferred = INFERRED_SOURCE_BY_COLUMN_NAME[name.toLowerCase()];
  if (inferred) {
    return { source: inferred, key: "", subkey: "" };
  }
  return { source: "metadata", key: name, subkey: "" };
}

/** Build a complete `{ source, key, subkey }` mapping from a dataset's
 *  columns. Guarantees a non-empty mapping whenever the dataset has columns,
 *  so records persisted by an authored trigger carry those columns. */
export function deriveMappingFromColumns(columns: DatasetColumns): DatasetMapping {
  return {
    mapping: Object.fromEntries(
      columns.map((column) => [column.name, entryForColumn(column.name)]),
    ),
    expansions: [],
  };
}

/** Read a dataset's `columnTypes` JSON column into the typed column list,
 *  tolerating malformed/legacy values (returns []). */
function columnsOf(dataset: { columnTypes?: unknown } | undefined): DatasetColumns {
  if (!dataset) return [];
  const parsed = datasetColumnsSchema.safeParse(dataset.columnTypes);
  return parsed.success ? parsed.data : [];
}

/** Columns whose mapping is still the fallback: the trace metadata key with
 *  the column's own name. Worth naming, since a trace without that key leaves
 *  the column empty. */
export function metadataFallbackColumns(mapping: DatasetMapping): string[] {
  return Object.entries(mapping.mapping)
    .filter(([column, entry]) => entry.source === "metadata" && entry.key === column)
    .map(([column]) => column);
}

function hasMapping(mapping: DatasetMapping): boolean {
  return Object.keys(mapping.mapping).length > 0;
}

function initialSlice(): DatasetSlice {
  return { datasetId: "", mapping: EMPTY_MAPPING };
}

function isComplete(slice: DatasetSlice): boolean {
  return slice.datasetId.length > 0 && hasMapping(slice.mapping);
}

function summary(slice: DatasetSlice, identity: SummaryIdentity): string {
  const name = identity.name || "(unnamed)";
  if (!slice.datasetId) return `${name} → dataset (not chosen)`;
  return slice.namedDataset?.id === slice.datasetId
    ? `${name} → dataset ${slice.namedDataset.name}`
    : `${name} → a dataset`;
}

function fromTriggerRow(row: SavedTriggerRow): DatasetSlice {
  const params = (row.actionParams ?? {}) as Partial<DatasetActionParams> & {
    datasetMapping?: DatasetMapping;
  };
  return {
    datasetId: typeof params.datasetId === "string" ? params.datasetId : "",
    mapping:
      params.datasetMapping &&
      typeof params.datasetMapping === "object" &&
      "mapping" in params.datasetMapping
        ? params.datasetMapping
        : EMPTY_MAPPING,
  };
}

function toActionParams(slice: DatasetSlice): DatasetActionParams {
  return {
    datasetId: slice.datasetId,
    datasetMapping: slice.mapping,
  };
}

function DatasetConfigForm({ slice, onChange, ctx }: ConfigFormProps<DatasetSlice>) {
  const datasets = useProjectDatasets({ projectId: ctx.projectId });
  const host = useAutomationHost();
  // Picking a dataset derives a default column mapping from its columns, so
  // the saved trigger never writes blank rows; the editor below refines it.
  const selectDataset = (datasetId: string) => {
    const dataset = datasets.data?.find((d) => d.id === datasetId);
    onChange({
      ...slice,
      datasetId,
      mapping: deriveMappingFromColumns(columnsOf(dataset)),
    });
  };

  // Backfill a default mapping for a row that already has a dataset but no
  // mapping yet (a legacy/blank trigger opened for edit) once the dataset list
  // loads, so saving it can't re-persist the empty mapping.
  useEffect(() => {
    if (!slice.datasetId || hasMapping(slice.mapping)) return;
    const dataset = datasets.data?.find((d) => d.id === slice.datasetId);
    if (!dataset) return;
    const derived = deriveMappingFromColumns(columnsOf(dataset));
    if (!hasMapping(derived)) return;
    onChange({ ...slice, mapping: derived });
    // onChange / slice are stable enough for this one-shot backfill; re-running
    // on the relevant inputs is sufficient and idempotent (guarded above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.datasetId, slice.mapping, datasets.data]);

  return (
    <VStack align="stretch" gap={3}>
      <DatasetSelector
        datasets={datasets.data}
        isLoading={datasets.isLoading}
        isError={datasets.isError}
        value={slice.datasetId}
        onChange={selectDataset}
        onCreateNew={createDataset}
      />
      {slice.datasetId && hasMapping(slice.mapping) ? (
        <DatasetMappingEditor
          key={slice.datasetId}
          columns={columnsOf(datasets.data?.find((d) => d.id === slice.datasetId)).map(
            (column) => column.name,
          )}
          mapping={slice.mapping}
          onMappingChange={(mapping) => onChange({ ...slice, mapping })}
        />
      ) : null}
    </VStack>
  );

  /** Hands over to the dataset drawer and comes back. `returned` runs on both
   *  endings, so an ending without a created dataset puts the previous target
   *  back rather than leaving the section silently incomplete. */
  function createDataset() {
    const previousDatasetId = slice.datasetId;
    let hasCreatedDataset = false;

    announceSubFlowDeparture();
    host.createDataset({
      created: ({ datasetId, columnTypes }) => {
        hasCreatedDataset = true;
        void datasets.refetch();
        onChange({
          ...slice,
          datasetId,
          mapping: deriveMappingFromColumns(columnTypes),
        });
      },
      returned: () => {
        if (!hasCreatedDataset && previousDatasetId) {
          onChange({ ...slice, datasetId: previousDatasetId });
        }
        keepDraftOnSubFlowReturn();
      },
    });
  }
}

/**
 * Which trace field fills each dataset column, saved with the automation. The same editor the
 * traces view uses, started from the automatic mapping and bound to the slice.
 */
function DatasetMappingEditor({
  columns,
  mapping,
  onMappingChange,
}: {
  columns: string[];
  mapping: DatasetMapping;
  onMappingChange: (mapping: DatasetMapping) => void;
}) {
  const parsed = mappingStateSchema.safeParse(mapping);
  const fallbacks = metadataFallbackColumns(mapping);
  const save = useMappingEditsOnly({ columns, savedMapping: mapping, onEdit: onMappingChange });

  return (
    <VStack align="stretch" gap={2} data-testid="dataset-mapping-editor">
      <Text color="fg.muted" textStyle="xs">
        Each column is filled from the trace field chosen for it. Columns start matched by name;
        change any of them here, and the mapping is saved with the automation.
      </Text>
      {columns.length > 0 ? (
        <TracesMapping
          traceMapping={parsed.success ? parsed.data : undefined}
          targetFields={columns}
          setTraceMapping={save}
          disableExpansions
        />
      ) : null}
      {fallbacks.length > 0 ? (
        <Text color="orange.fg" textStyle="xs" data-testid="metadata-fallback">
          Filled from the trace metadata key with the same name: {fallbacks.join(", ")}. A trace
          without that key leaves the column empty, so pick the field it should come from.
        </Text>
      ) : null}
    </VStack>
  );
}

const client: ClientDef<DatasetSlice> = {
  Icon: Database,
  initialSlice,
  isComplete,
  summary,
  fromTriggerRow,
  toActionParams,
  ConfigForm: DatasetConfigForm,
};

export default client;
