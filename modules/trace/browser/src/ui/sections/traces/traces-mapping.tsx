import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import {
  type DatasetRecordEntry,
  type MappingState,
  SERVER_ONLY_TRACE_SOURCES,
  TRACE_EXPANSIONS,
} from "@langwatch/dataset-contract";
import { Field, Grid, GridItem, Text, VStack } from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import { nowInstant } from "@langwatch/time";
import type { Trace } from "@langwatch/trace-contract";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../../behavior/trace-api.ts";
import {
  availableExpansionsFor,
  datasetEntriesFor,
  type LocalTraceMappingState,
  mappingStateDiffers,
  mappingStateWithDefaults,
  mapsAnySource,
  PROJECT_FIELD_NAME_SOURCES,
  targetEdgesWithDefaults,
  type TraceExpansion,
  type WorkflowMappingTarget,
  withExpansion,
} from "../../../model/traces/mapping/traces-mapping.ts";
import { useAnnotationsByTraceIds } from "../use-annotations-by-trace-ids.ts";
import { useProjectEventTypes } from "../use-project-event-types.ts";
import { useProjectSpanNames } from "../use-project-span-names.ts";
import { type ProjectKeyNames, TracesMappingRow } from "./traces-mapping-row.tsx";

const EMPTY_MAPPING: MappingState = { mapping: {}, expansions: [] };

/** The mapping state as the parent stores it: expansions as a list. */
const storedMappingState = (state: LocalTraceMappingState): MappingState => ({
  ...state,
  expansions: Array.from(state.expansions),
});

/**
 * The local mapping state, readable synchronously. Two updates in one tick (two
 * switches clicked before React re-renders) would otherwise both build on the
 * render's stale value, and the second would undo the first.
 */
function useLocalMappingState(setTraceMapping?: (mapping: MappingState) => void) {
  const [state, setState] = useState<LocalTraceMappingState>({
    mapping: {},
    expansions: new Set(),
  });
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const replace = useCallback(
    (next: LocalTraceMappingState) => {
      stateRef.current = next;
      setState(next);
      setTraceMapping?.(storedMappingState(next));
    },
    [setTraceMapping],
  );
  const update = useCallback(
    (callback: (state: LocalTraceMappingState) => LocalTraceMappingState) =>
      replace(callback(stateRef.current)),
    [replace],
  );
  return { state, replace, update };
}

/** Every trace in the traces' threads, read the way the mapped traces were. */
function useThreadTraces({
  projectId,
  traces,
  withEditOverlay,
}: {
  projectId: string | undefined;
  traces: Trace[];
  withEditOverlay: boolean;
}) {
  const threadIds = useMemo(
    () =>
      Array.from(
        new Set(
          traces.map((trace) => trace.metadata?.thread_id).filter((id): id is string => !!id),
        ),
      ),
    [traces],
  );
  return api.traces.getTracesWithSpansByThreadIds.useQuery(
    { projectId: projectId ?? "", threadIds, withEditOverlay },
    { enabled: !!projectId && threadIds.length > 0, refetchOnWindowFocus: false },
  ).data;
}

/**
 * The project-wide names the key dropdowns offer, fetched only once a column
 * maps a source that needs them, so opening the mapping alone costs no scan.
 */
function useProjectKeyNames({
  projectId,
  mapping,
}: {
  projectId: string | undefined;
  mapping: LocalTraceMappingState["mapping"];
}): ProjectKeyNames {
  const fieldNames = useProjectSpanNames({
    projectId,
    enabled: mapsAnySource({ mapping, sources: PROJECT_FIELD_NAME_SOURCES }),
  });
  const eventTypes = useProjectEventTypes({
    projectId,
    enabled: mapsAnySource({ mapping, sources: ["events"] }),
  });
  const options = useMemo(
    () => ({
      spans: fieldNames.spanNames,
      metadata: fieldNames.metadataKeys,
      evaluations: fieldNames.evaluationNames,
      events: eventTypes.eventTypes,
    }),
    [
      fieldNames.spanNames,
      fieldNames.metadataKeys,
      fieldNames.evaluationNames,
      eventTypes.eventTypes,
    ],
  );
  return {
    options,
    fieldNamesLoading: fieldNames.isLoading,
    eventTypesLoading: eventTypes.isLoading,
  };
}

/** Switches that normalise the dataset to one row per expanded item. */
function ExpansionSwitches({
  available,
  expansions,
  onChange,
}: {
  available: Set<TraceExpansion>;
  expansions: Set<TraceExpansion>;
  onChange: (expansion: TraceExpansion, isChecked: boolean) => void;
}) {
  // The switches sit outside the field on purpose: a field hands one id to every
  // control inside it, so each switch's label pointed at the first switch.
  return (
    <VStack width="full" align="start" paddingY={4} marginTop={2} gap={0}>
      <Field.Root width="full">
        <VStack align="start">
          <Field.Label margin={0}>Expansions</Field.Label>
          <Field.HelperText margin={0} fontSize="13px" marginBottom={2} maxWidth="600px">
            Normalize the dataset to duplicate the rows and have one entry per line instead of an
            array for the following mappings:
          </Field.HelperText>
        </VStack>
      </Field.Root>
      <VStack align="start" paddingTop={2} gap={2}>
        {Array.from(available).map((expansion) => (
          <Switch
            key={expansion}
            checked={expansions.has(expansion)}
            onCheckedChange={(event) => onChange(expansion, event.checked)}
          >
            One row per {TRACE_EXPANSIONS[expansion].label}
          </Switch>
        ))}
      </VStack>
    </VStack>
  );
}

export const TracesMapping = ({
  titles,
  traces,
  traceMapping,
  dsl,
  targetFields,
  setDatasetEntries,
  setTraceMapping,
  disableExpansions,
  skipSettingDefaultEdges,
  shouldApplyCorrections = false,
}: {
  titles?: string[];
  traces: Trace[];
  traceMapping?: MappingState;
  dsl?: WorkflowMappingTarget;
  targetFields: string[];
  setDatasetEntries?: (entries: DatasetRecordEntry[]) => void;
  setTraceMapping?: (mapping: MappingState) => void;
  disableExpansions?: boolean;
  /**
   * To consider: This is a hacky way to prevent the default edges from being set.
   */
  skipSettingDefaultEdges?: boolean;
  /**
   * Whether the traces handed in already carry the reviewer's corrections.
   */
  shouldApplyCorrections?: boolean;
}) => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  // A dataset row carries what the reviewers said about the trace, span-level
  // comments included: they are the most specific reviews of all.
  const annotationScores = useAnnotationsByTraceIds({
    projectId: projectId ?? "",
    traceIds: traces.map((trace) => trace.trace_id),
    enabled: !!project,
    anchor: "all",
  });
  const annotationScoreOptions = api.annotationScore.getAllActive.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  ).data;
  const threadTraces = useThreadTraces({
    projectId,
    traces,
    withEditOverlay: shouldApplyCorrections,
  });
  const annotatedTraces = useMemo(
    () =>
      traces.map((trace) => ({
        ...trace,
        annotations: annotationScores.data?.filter(
          (annotation) => annotation.traceId === trace.trace_id,
        ),
      })),
    [traces, annotationScores.data],
  );

  const currentMapping = traceMapping ?? EMPTY_MAPPING;
  const { state, replace, update } = useLocalMappingState(setTraceMapping);
  const mapping = state.mapping;
  const names = useProjectKeyNames({ projectId, mapping });

  // A server-only column quotes the whole trace, read the way the mapped traces
  // were, so an uncorrected read would put back what the other columns leave out.
  const formattedDigests = api.traces.getFormattedSpansDigest.useQuery(
    {
      projectId: projectId ?? "",
      traceIds: traces.map((t) => t.trace_id),
      withEditOverlay: shouldApplyCorrections,
    },
    {
      enabled:
        !!projectId &&
        traces.length > 0 &&
        mapsAnySource({ mapping, sources: SERVER_ONLY_TRACE_SOURCES }),
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  ).data;

  const availableExpansions = useMemo(() => availableExpansionsFor(mapping), [mapping]);
  const expansions = useMemo(
    () => new Set(Array.from(state.expansions).filter((x) => availableExpansions.has(x))),
    [state.expansions, availableExpansions],
  );

  const now = useMemo(() => nowInstant().epochMilliseconds, []);
  const isInitializedRef = React.useRef(false);
  // The entries effect builds a fresh array every run; without this guard the
  // parent's re-render feeds back into it past React's update depth.
  const lastEntriesRef = React.useRef<string | null>(null);

  useEffect(() => {
    const next = mappingStateWithDefaults({
      state,
      stored: currentMapping,
      targetFields,
      isInitialized: isInitializedRef.current,
    });
    if (!isInitializedRef.current || mappingStateDiffers({ state, next })) {
      replace(next);
      isInitializedRef.current = true;
    }
    if (dsl && !skipSettingDefaultEdges) {
      dsl.setTargetEdges?.(
        targetEdgesWithDefaults({ dsl, targetFields, now: nowInstant().epochMilliseconds }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(targetFields), dsl?.sourceOptions, JSON.stringify(currentMapping)]);

  useEffect(() => {
    const entries = datasetEntriesFor({
      traces: annotatedTraces,
      mapping,
      expansions,
      annotationScoreOptions,
      allTraces: threadTraces ?? annotatedTraces,
      formattedDigests,
      now,
    });
    const serialized = JSON.stringify(entries);
    if (serialized === lastEntriesRef.current) return;
    lastEntriesRef.current = serialized;
    setDatasetEntries?.(entries);
  }, [
    expansions,
    annotationScoreOptions,
    mapping,
    setDatasetEntries,
    annotatedTraces,
    threadTraces,
    formattedDigests,
    now,
  ]);

  return (
    <Grid
      width="full"
      templateColumns={dsl ? "1fr auto 1fr auto 1fr" : "1fr auto 1fr"}
      alignItems="center"
      gap={2}
    >
      {titles?.map((title, idx) => (
        <GridItem key={title} colSpan={idx === titles.length - 1 ? 1 : 2} paddingBottom={2}>
          <Text fontWeight="semibold">{title}</Text>
        </GridItem>
      ))}
      {Object.entries(mapping).map(([targetField, entry], index) => (
        <TracesMappingRow
          key={index}
          targetField={targetField}
          index={index}
          dsl={dsl}
          traceSource={
            traceMapping && {
              entry,
              traces: annotatedTraces,
              annotationScoreOptions,
              names,
              availableExpansions,
              update,
            }
          }
        />
      ))}
      {!disableExpansions && availableExpansions.size > 0 && (
        <ExpansionSwitches
          available={availableExpansions}
          expansions={expansions}
          onChange={(expansion, isChecked) =>
            update((prev) => withExpansion({ state: prev, expansion, isChecked }))
          }
        />
      )}
    </Grid>
  );
};
