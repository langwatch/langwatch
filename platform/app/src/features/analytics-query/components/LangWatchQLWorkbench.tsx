/**
 * The LangWatchQL workbench: schema on the left, editor and result on the
 * right.
 *
 * It composes and wires; it decides nothing about SQL. The statement is handed
 * to the endpoint exactly as typed, and everything the member is told about it
 * afterwards is the backend's answer rendered through the error registry.
 *
 * The surface is two cards over a quiet ground: the query card — header row,
 * editor, parameters — and the result card below it. The schema browser sits
 * in a flat side panel rather than a third card, so the page reads as one
 * instrument rather than a stack of boxes.
 *
 * @see specs/analytics/lwql-workbench.feature
 */

import { Box, Button, HStack, Kbd, Spinner, Text } from "@chakra-ui/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { usePeriodSelector } from "~/components/PeriodSelector";
// The leaf module, never the barrel — see LangWatchQLTimeWindowEditor.
import {
  formatLangWatchQLDateTimeParameter,
  isLangWatchQLSurfaceParameter,
  type LangWatchQLGranularityStep,
  LWQL_GRANULARITY_STEPS,
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_GRANULARITY_PARAMETER,
  LWQL_PERIOD_START_PARAMETER,
} from "~/server/analytics/lwql/timeWindow";

import { useLangWatchQLQuery } from "../hooks/useLangWatchQLQuery";
import { useLangWatchQLSchema } from "../hooks/useLangWatchQLSchema";
import { useSavedChartWiring } from "../hooks/useSavedChartWiring";
import {
  type LangWatchQLEditorMarker,
  LWQL_PARAMETER_MISSING_CODE,
  LWQL_RESERVED_PARAMETER_SUPPLIED_CODE,
  lwqlEditorMarkers,
  readLangWatchQLFailure,
} from "../logic/lwqlFailure";
import {
  isLangWatchQLResultStale,
  type LangWatchQLRequestState,
  type LangWatchQLTimeWindowValues,
} from "../logic/lwqlRequestState";
import { LangWatchQLEditor } from "./LangWatchQLEditor";
import { LangWatchQLGranularityPicker } from "./LangWatchQLGranularityPicker";
import {
  type LangWatchQLParametersChange,
  LangWatchQLParametersEditor,
} from "./LangWatchQLParametersEditor";
import {
  LangWatchQLResultPane,
  type LangWatchQLResultView,
} from "./LangWatchQLResultPane";
import { LangWatchQLSchemaBrowser } from "./LangWatchQLSchemaBrowser";
import { LangWatchQLTimeWindowEditor } from "./LangWatchQLTimeWindowEditor";
import { LazyLangWatchQLChartMode } from "./LazyLangWatchQLChartMode";
import { SavedChartsToolbar } from "./SavedChartsToolbar";

/** What a refusal gives the editor and the parameters form to work with. */
interface FailureView {
  readonly markers: readonly LangWatchQLEditorMarker[];
  readonly missingParameters: readonly string[];
  readonly reservedParameters: readonly string[];
  /**
   * Whether the last refusal said the statement declares the granularity step
   * and no value filled it. Shows the picker for a statement that has never
   * run, which is every granularity statement's first submission.
   */
  readonly awaitsGranularity: boolean;
}

/** Stable identity, so an unchanged "nothing to report" never re-renders a form. */
const NO_FAILURE_VIEW: FailureView = {
  markers: [],
  missingParameters: [],
  reservedParameters: [],
  awaitsGranularity: false,
};

/**
 * The chart's accessible description of what it draws: the submitted statement
 * that produced the visible result — the outcome's own snapshot, so a stale
 * result is described by the query that ran, not the one being typed —
 * collapsed to one line and cut short, because an accessible name is read
 * aloud in full.
 */
function chartResultLabel(sql: string): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}…` : collapsed;
}

/**
 * Splits the names a missing-parameter refusal listed into the ones a member
 * can actually fill in and the reserved ones they cannot.
 *
 * A reserved name reaching that list is not a member's omission: it is the
 * surface's own to supply, and the granularity step's arrives on the very first
 * run of a statement that declares it. Prompting for it sent the member to a
 * form where typing the name is itself refused — the catch-22 this split
 * removes. The step gets its own control instead.
 */
function splitMissing(names: readonly string[]): {
  fillable: readonly string[];
  reserved: readonly string[];
} {
  return {
    fillable: names.filter((name) => !isLangWatchQLSurfaceParameter(name)),
    reserved: names.filter((name) => isLangWatchQLSurfaceParameter(name)),
  };
}

function failureView(state: LangWatchQLRequestState): FailureView {
  const { outcome } = state;
  if (outcome?.kind !== "error") return NO_FAILURE_VIEW;

  // A refusal belonging to a statement the member has since rewritten must not
  // underline a line of the statement now in the editor, nor name parameters
  // the current draft may no longer declare. The result pane still shows the
  // refusal, labelled as the previous submission's; only the annotations that
  // point AT the buffer are withdrawn.
  if (isLangWatchQLResultStale(state)) return NO_FAILURE_VIEW;

  const failure = readLangWatchQLFailure(outcome.error);
  const missing =
    failure.code === LWQL_PARAMETER_MISSING_CODE
      ? splitMissing(failure.parameters)
      : { fillable: [], reserved: [] };
  return {
    markers: lwqlEditorMarkers(failure),
    // The payload carries one list of names; only the code says what they
    // mean, so only the code decides which form answers them. Every other
    // refusal is about the statement.
    missingParameters: missing.fillable,
    reservedParameters:
      failure.code === LWQL_RESERVED_PARAMETER_SUPPLIED_CODE
        ? failure.parameters
        : [],
    // A refusal naming the step is the only way the workbench learns a
    // statement declares it before anything has successfully run.
    awaitsGranularity: missing.reserved.includes(
      LWQL_PERIOD_GRANULARITY_PARAMETER,
    ),
  };
}

/**
 * Whether the visible answer's statement followed the page's period.
 *
 * `undefined` until a result says so: the backend is the only thing that parses
 * the SQL, and a stale answer describes a statement the member has since
 * rewritten — labelling the draft with it would be a claim about a query that
 * was never run.
 */
function followsTimeWindowOf(
  state: LangWatchQLRequestState,
): boolean | undefined {
  if (state.outcome?.kind !== "result") return undefined;
  if (isLangWatchQLResultStale(state)) return undefined;
  return state.outcome.result.followsTimeWindow;
}

/**
 * The step the visible answer was bucketed at, when it reports one.
 *
 * Read off the result for the same reason `followsTimeWindow` is: only the
 * backend parses the statement. Staleness is not consulted, because choosing a
 * step is itself what makes the visible result stale — and the note this feeds
 * describes the answer on screen, which is exactly the stale one.
 */
function ranAtGranularityOf(state: LangWatchQLRequestState): {
  ranAt?: number;
  coarsenedFrom?: number;
} {
  if (state.outcome?.kind !== "result") return {};
  const { result } = state.outcome;
  return {
    ...(result.granularitySeconds !== undefined
      ? { ranAt: result.granularitySeconds }
      : {}),
    ...(result.coarsenedFromSeconds !== undefined
      ? { coarsenedFrom: result.coarsenedFromSeconds }
      : {}),
  };
}

/**
 * What the last answer said about the statement declaring the step.
 *
 * `undefined` when the answer says nothing either way, which is every failure
 * other than the unfilled-step refusal — a timeout tells you nothing about what
 * the statement declares, so it must not be read as a denial.
 *
 * Deliberately NOT filtered by staleness, unlike `followsTimeWindow`. The step
 * is part of the draft, so choosing one makes the visible result stale by
 * definition; hiding the picker on that basis would retract the very control
 * that was just used. Staleness governs what a result *claims*, not whether the
 * control that produced it exists.
 */
function granularityDeclaredBy(
  state: LangWatchQLRequestState,
  awaitsGranularity: boolean,
): boolean | undefined {
  if (awaitsGranularity) return true;
  if (state.outcome?.kind === "result") {
    return state.outcome.result.followsGranularity;
  }
  return undefined;
}

/**
 * The step the workbench sends, held for the member.
 *
 * Shows the coarsest offered step rather than the finest: the coarsest is the
 * one that fits the bucket budget over any period a page can show, so the first
 * run of a granularity statement answers instead of being refused for asking a
 * finer question than the member ever asked for.
 *
 * That shown step is NOT written into the draft until the member picks one or
 * runs, and the distinction is load-bearing. The picker appears in response to
 * a refusal; writing to the draft as it appeared would move the draft away from
 * the snapshot that refusal belongs to, marking it stale — and a stale refusal
 * has its annotations withdrawn, so the very act of offering the step would
 * erase the rest of the refusal that prompted it, including the member's own
 * missing parameters. What the picker renders as pressed and what a submission
 * carries must still be the same number, so `armForRun` writes the shown step
 * — chosen or default — into the draft at the moment Run is pressed, when
 * staling the refusal is exactly what running does anyway.
 */
function useWorkbenchGranularity({
  query,
  declared,
  openedRevision,
}: {
  query: ReturnType<typeof useLangWatchQLQuery>;
  /** What the last answer said, or `undefined` when it said nothing. */
  declared: boolean | undefined;
  /** Bumped whenever a saved chart is opened. */
  openedRevision: number;
}) {
  const coarsest =
    LWQL_GRANULARITY_STEPS[LWQL_GRANULARITY_STEPS.length - 1] ?? 3600;
  // `null` until the member picks: the shown step is what the control reads,
  // the chosen step is what the request carries, and only the second is a
  // change to the draft. Keyed to the opened revision the way the window
  // override is: a step picked while chart A was open must not become the step
  // chart B renders — or sends — the moment it is opened.
  const [chosen, setChosen] = useState<{
    revision: number;
    step: LangWatchQLGranularityStep;
  } | null>(null);
  // Held rather than derived per render, and this is load-bearing. Sending the
  // step puts it in the draft, which makes the visible result stale; deriving
  // "does it declare one" from that same result would flip the answer back,
  // clear the step, un-stale the result, and set it again — an update loop
  // through the store. What the statement declares is a fact about a past
  // answer, so it is remembered as one.
  const [shown, setShown] = useState<{ revision: number; on: boolean }>({
    revision: openedRevision,
    on: false,
  });
  // The revision the last submission ran under. `declared` is read off the
  // live outcome, and the outcome does not know which chart earned it: open a
  // chart whose statement is byte-identical to a refused one and the old
  // refusal stops being stale — its answer would resurrect the picker for a
  // chart that has never run. Only an answer produced by this revision's own
  // run may flip the picker.
  const [ranRevision, setRanRevision] = useState<number | null>(null);

  // Opening a saved chart replaces the statement, so what the previous one
  // declared says nothing about this one.
  const on = shown.revision === openedRevision && shown.on;
  if (
    declared !== undefined &&
    ranRevision === openedRevision &&
    declared !== on
  ) {
    setShown({ revision: openedRevision, on: declared });
  } else if (shown.revision !== openedRevision) {
    setShown({ revision: openedRevision, on: false });
  }

  const chosenStep =
    chosen !== null && chosen.revision === openedRevision ? chosen.step : null;
  const value = chosenStep ?? coarsest;

  const { setGranularity } = query;
  // Cleared while the statement does not declare the parameter: sending a step
  // for a statement that never asked for one makes it a reserved value the
  // backend refuses.
  useEffect(() => {
    setGranularity(on && chosenStep !== null ? chosenStep : undefined);
  }, [setGranularity, on, chosenStep]);

  const onChange = useCallback(
    (step: LangWatchQLGranularityStep) =>
      setChosen({ revision: openedRevision, step }),
    [openedRevision],
  );

  // Every submission goes through this rather than `query.runQuery`: while
  // the picker is on screen, the request must carry the very step it shows as
  // pressed — a picker that renders a pressed default but sends nothing earns
  // the missing-parameter refusal for a value the member is looking at. The
  // controller is synchronous, so arming writes the draft before the same
  // tick snapshots it.
  const { runQuery } = query;
  const run = useCallback(() => {
    setRanRevision(openedRevision);
    setGranularity(on ? value : undefined);
    runQuery();
  }, [setGranularity, on, value, openedRevision, runQuery]);

  return { value, onChange, shown: on, run };
}

/**
 * The period the next submission reports over: the page's, unless the member
 * has overridden it for this query.
 *
 * The page's period is the default rather than a starting value that then drifts
 * — an unoverridden workbench follows the period selector for as long as it is
 * open, which is what makes authoring behave the way the dashboard will.
 *
 * The override is scoped to the opened chart's revision the same way the
 * specification draft is: a window held while chart A was open must not become
 * the window chart B runs with the moment it is opened.
 */
function useWorkbenchTimeWindow({
  query,
  openedRevision,
}: {
  query: ReturnType<typeof useLangWatchQLQuery>;
  /** Bumped whenever a saved chart is opened. */
  openedRevision: number;
}) {
  const { period } = usePeriodSelector();
  const [override, setOverride] = useState<{
    revision: number;
    window: LangWatchQLTimeWindowValues;
  } | null>(null);
  // Whether the editor's visible text names a window that can run. Held here
  // so the Run gate and the editor read one answer.
  const [sendable, setSendable] = useState(true);

  const pagePeriod = useMemo(
    () => ({
      start: period.startDate.getTime(),
      end: period.endDate.getTime(),
    }),
    [period.startDate, period.endDate],
  );
  const held =
    override !== null && override.revision === openedRevision
      ? override.window
      : null;
  const value = held ?? pagePeriod;

  const { setTimeWindow } = query;
  useEffect(() => {
    setTimeWindow(value);
  }, [setTimeWindow, value]);

  return {
    value,
    overridden: held !== null,
    sendable,
    onSendableChange: setSendable,
    onOverride: useCallback(
      (window: LangWatchQLTimeWindowValues) =>
        setOverride({ revision: openedRevision, window }),
      [openedRevision],
    ),
    onFollowPage: useCallback(() => setOverride(null), []),
  };
}

export interface LangWatchQLWorkbenchProps {
  projectId: string;
}

/**
 * The query card's header row: the name of the card, and the one action that
 * talks to the server.
 *
 * The action's label is the request state's own answer, so what the button says
 * and what pressing it does can never disagree. While a request is in flight
 * the row carries a running indicator and Cancel instead; cancelling keeps
 * whatever result was already on screen.
 */
function QueryCardHeader({
  schemaVisible,
  onToggleSchema,
  actionLabel,
  runnable,
  isInFlight,
  onRun,
  onCancel,
  savedCharts,
}: {
  schemaVisible: boolean;
  onToggleSchema: () => void;
  actionLabel: string;
  runnable: boolean;
  isInFlight: boolean;
  onRun: () => void;
  onCancel: () => void;
  /** Save and Open. Supplied by the workbench, which owns the saved chart. */
  savedCharts: ReactNode;
}) {
  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={2}
      borderBottomWidth="1px"
      borderColor="border"
    >
      <Button
        size="xs"
        variant="ghost"
        aria-label={schemaVisible ? "Hide the schema" : "Show the schema"}
        onClick={onToggleSchema}
      >
        <Box aria-hidden="true" display="flex">
          {schemaVisible ? (
            <PanelLeftClose size={14} />
          ) : (
            <PanelLeftOpen size={14} />
          )}
        </Box>
      </Button>
      <Text fontSize="13px" fontWeight="600">
        Query
      </Text>
      <Box flex="1" />
      {savedCharts}
      <Kbd size="sm" aria-hidden="true">
        ⌘⏎
      </Kbd>
      {isInFlight ? (
        <>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" colorPalette="orange" disabled opacity={0.85}>
            <Spinner size="xs" /> Running
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          colorPalette="orange"
          disabled={!runnable}
          onClick={onRun}
        >
          {actionLabel}
        </Button>
      )}
    </HStack>
  );
}

/**
 * Writing into the draft. The editor hands back a writer once Monaco has
 * mounted; until then, and in any environment without it, an insert appends to
 * the draft instead of silently doing nothing.
 */
function useDraftInsert({
  query,
  exampleSql,
}: {
  query: ReturnType<typeof useLangWatchQLQuery>;
  exampleSql: string | undefined;
}) {
  const insertRef = useRef<((text: string) => void) | null>(null);
  const registerInsert = useCallback(
    (insert: ((text: string) => void) | null) => {
      insertRef.current = insert;
    },
    [],
  );

  const draftSql = query.state.draft.sql;
  const { setSql } = query;
  const handleInsert = useCallback(
    (text: string) => {
      const insert = insertRef.current;
      if (insert) return insert(text);

      setSql(
        draftSql.length === 0
          ? text
          : `${draftSql}${draftSql.endsWith("\n") ? "" : "\n"}${text}`,
      );
    },
    [draftSql, setSql],
  );

  // What the empty state offers: the first dataset's example, written into the
  // draft. The example text is the schema response's own, so an empty workbench
  // with no schema simply offers nothing.
  const insertExample = useMemo(
    () =>
      exampleSql === undefined ? undefined : () => handleInsert(exampleSql),
    [exampleSql, handleInsert],
  );

  return { registerInsert, handleInsert, insertExample };
}

/**
 * The chart specification lives here rather than in chart mode, which a
 * refused query unmounts. A member who edits a chart, hits a refusal, fixes
 * the SQL and runs again finds the chart they wrote, not the example.
 *
 * Scoped to the opened chart's revision: opening a saved chart shows that
 * chart's specification, not an edit made against the previous one.
 */
function useSpecDraft(wiring: ReturnType<typeof useSavedChartWiring>) {
  // `text` is three-way: `undefined` means the member has not touched the
  // specification, `null` means they asked for the starter back, and a string
  // is their edit. Collapsing the first two made Reset a no-op while a saved
  // chart was open — `null` fell through to the chart's stored specification,
  // and the member had no way back to the starter.
  const [specDraft, setSpecDraft] = useState<{
    revision: number;
    text: string | null | undefined;
  }>({ revision: wiring.openedRevision, text: undefined });
  const editedSpecText =
    specDraft.revision === wiring.openedRevision ? specDraft.text : undefined;
  const openedRevision = wiring.openedRevision;
  const setEditedSpecText = useCallback(
    (text: string | null) => setSpecDraft({ revision: openedRevision, text }),
    [openedRevision],
  );
  // What the chart is handed: the member's edit (a reset counts as one), else
  // the opened chart's saved specification, else `null` — which chart mode
  // reads as "follow the starter for the result on screen".
  const shownSpecText =
    editedSpecText === undefined
      ? (wiring.openedSpecText ?? null)
      : editedSpecText;
  return { shownSpecText, setEditedSpecText };
}

/** The result card: every pixel the query card leaves, behind one border. */
function ResultCard({
  query,
  onRun,
  insertExample,
  wiring,
  shownSpecText,
  setEditedSpecText,
}: {
  query: ReturnType<typeof useLangWatchQLQuery>;
  /** Submits the draft with the shown granularity step armed. */
  onRun: () => void;
  insertExample: (() => void) | undefined;
  wiring: ReturnType<typeof useSavedChartWiring>;
  shownSpecText: string | null;
  setEditedSpecText: (text: string | null) => void;
}) {
  return (
    <Box
      background="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="10px"
      boxShadow="xs"
      overflow="hidden"
      flex="1"
      minHeight={0}
      display="flex"
      flexDirection="column"
    >
      <LangWatchQLResultPane
        state={query.state}
        onRun={onRun}
        {...(insertExample ? { onInsertExample: insertExample } : {})}
        renderChartArea={chartArea({
          state: query.state,
          registerSpecReader: wiring.registerSpecReader,
          openedRevision: wiring.openedRevision,
          editedSpecText: shownSpecText,
          onEditedSpecTextChange: setEditedSpecText,
        })}
      />
    </Box>
  );
}

export function LangWatchQLWorkbench({ projectId }: LangWatchQLWorkbenchProps) {
  const schema = useLangWatchQLSchema({ projectId });
  const query = useLangWatchQLQuery({ projectId });

  const [schemaVisible, setSchemaVisible] = useState(true);
  const wiring = useSavedChartWiring({ projectId, query });
  const { parameters, parametersSendable } = useParameterState({
    query,
    openedRevision: wiring.openedRevision,
  });
  const { registerInsert, handleInsert, insertExample } = useDraftInsert({
    query,
    exampleSql: schema.model.datasets[0]?.exampleSql,
  });
  const failure = useMemo(() => failureView(query.state), [query.state]);
  const timeWindow = useWorkbenchTimeWindow({
    query,
    openedRevision: wiring.openedRevision,
  });
  const granularity = useWorkbenchGranularity({
    query,
    declared: granularityDeclaredBy(query.state, failure.awaitsGranularity),
    openedRevision: wiring.openedRevision,
  });
  const { shownSpecText, setEditedSpecText } = useSpecDraft(wiring);

  return (
    <HStack
      align="stretch"
      gap={0}
      width="full"
      flex="1"
      minHeight={0}
      data-testid="lwql-workbench"
    >
      {schemaVisible && (
        <SchemaSidebar schema={schema} onInsert={handleInsert} />
      )}

      <Box
        flex="1"
        minWidth={0}
        minHeight={0}
        display="flex"
        flexDirection="column"
        gap={3}
        padding={4}
      >
        {/* The query card hugs its statement; the result card below takes
            every remaining pixel. This split is the page's shape — inverting
            it is what buries a result under an empty editor. */}
        <QueryCard
          query={query}
          onRun={granularity.run}
          schemaModel={schema.model}
          failure={failure}
          registerInsert={registerInsert}
          schemaVisible={schemaVisible}
          onToggleSchema={() => setSchemaVisible((visible) => !visible)}
          wiring={wiring}
          timeWindow={timeWindow}
          granularity={granularity}
          onParametersChange={parameters}
          parametersSendable={parametersSendable}
        />

        <ResultCard
          query={query}
          onRun={granularity.run}
          insertExample={insertExample}
          wiring={wiring}
          shownSpecText={shownSpecText}
          setEditedSpecText={setEditedSpecText}
        />
      </Box>
    </HStack>
  );
}

function SchemaSidebar({
  schema,
  onInsert,
}: {
  schema: ReturnType<typeof useLangWatchQLSchema>;
  onInsert: (text: string) => void;
}) {
  return (
    <Box
      width="292px"
      flexShrink={0}
      overflowY="auto"
      background="bg.panel"
      borderRightWidth="1px"
      borderColor="border"
    >
      <LangWatchQLSchemaBrowser
        model={schema.model}
        isLoading={schema.isLoading}
        error={schema.error}
        onInsert={onInsert}
      />
    </Box>
  );
}

/**
 * The parameters form's two answers, which are computed together and must not
 * disagree: the values to send, and whether every row can be sent at all.
 *
 * A row the form cannot send is dropped from the values — so without the second
 * answer, Run stays lit and the round-trip comes back naming a parameter the
 * member is looking at, filled in.
 */
/**
 * The reserved parameters' current live values, formatted the way the
 * statement receives them — an ISO instant for the window, the plain integer
 * for the step — so the read-only rows above the author's own show what those
 * names actually resolve to.
 */
function builtinParameterValues({
  timeWindow,
  granularity,
}: {
  timeWindow: ReturnType<typeof useWorkbenchTimeWindow>;
  granularity: ReturnType<typeof useWorkbenchGranularity>;
}): Readonly<Record<string, string>> {
  return {
    [LWQL_PERIOD_START_PARAMETER]: formatLangWatchQLDateTimeParameter(
      new Date(timeWindow.value.start),
    ),
    [LWQL_PERIOD_END_PARAMETER]: formatLangWatchQLDateTimeParameter(
      new Date(timeWindow.value.end),
    ),
    [LWQL_PERIOD_GRANULARITY_PARAMETER]: String(granularity.value),
  };
}

function useParameterState({
  query,
  openedRevision,
}: {
  query: ReturnType<typeof useLangWatchQLQuery>;
  openedRevision: number;
}) {
  const [parametersSendable, setParametersSendable] = useState(true);
  const { setParameters } = query;

  // Opening a saved chart remounts the parameters form with the chart's own
  // values, and the remount announces nothing — a `false` left behind by a
  // form that no longer exists would keep Run disabled with every visible row
  // valid, and nothing on screen would say why.
  useEffect(() => {
    setParametersSendable(true);
  }, [openedRevision]);

  const parameters = useCallback(
    ({ parameters: values, sendable }: LangWatchQLParametersChange) => {
      setParameters(values);
      setParametersSendable(sendable);
    },
    [setParameters],
  );

  return { parameters, parametersSendable };
}

function QueryCard({
  query,
  onRun,
  schemaModel,
  failure,
  registerInsert,
  schemaVisible,
  onToggleSchema,
  wiring,
  timeWindow,
  granularity,
  onParametersChange,
  parametersSendable,
}: {
  query: ReturnType<typeof useLangWatchQLQuery>;
  /** Submits the draft with the shown granularity step armed. */
  onRun: () => void;
  schemaModel: ReturnType<typeof useLangWatchQLSchema>["model"];
  failure: FailureView;
  registerInsert: (insert: ((text: string) => void) | null) => void;
  schemaVisible: boolean;
  onToggleSchema: () => void;
  wiring: ReturnType<typeof useSavedChartWiring>;
  timeWindow: ReturnType<typeof useWorkbenchTimeWindow>;
  granularity: ReturnType<typeof useWorkbenchGranularity>;
  onParametersChange: (change: LangWatchQLParametersChange) => void;
  parametersSendable: boolean;
}) {
  const { draft } = query.state;

  return (
    <Box
      flexShrink={0}
      background="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="10px"
      boxShadow="xs"
      overflow="hidden"
    >
      <QueryCardHeader
        schemaVisible={schemaVisible}
        onToggleSchema={onToggleSchema}
        actionLabel={query.actionLabel}
        runnable={
          draft.sql.trim().length > 0 &&
          parametersSendable &&
          timeWindow.sendable &&
          !query.state.isInFlight
        }
        isInFlight={query.state.isInFlight}
        // Always the draft, under either label. When the label reads
        // "Reload" the draft is byte-identical to what produced the visible
        // result, so this IS a reload — and unlike `reload()` it can never
        // re-send a superseded submission the member is no longer looking
        // at.
        onRun={onRun}
        onCancel={query.cancelQuery}
        savedCharts={
          <BoundSavedCharts
            wiring={wiring}
            canSave={draft.sql.trim().length > 0}
          />
        }
      />

      <LangWatchQLEditor
        sql={draft.sql}
        onChange={query.setSql}
        schema={schemaModel}
        markers={failure.markers}
        registerInsert={registerInsert}
        onRun={onRun}
      />

      <Box
        borderTopWidth="1px"
        borderColor="border"
        background="bg.subtle"
        paddingX={3}
        paddingY={2}
        display="flex"
        flexDirection="column"
        gap={3}
      >
        <LangWatchQLTimeWindowEditor
          value={timeWindow.value}
          overridden={timeWindow.overridden}
          onOverride={timeWindow.onOverride}
          onFollowPage={timeWindow.onFollowPage}
          followsTimeWindow={followsTimeWindowOf(query.state)}
          onSendableChange={timeWindow.onSendableChange}
        />

        <GranularityRow query={query} granularity={granularity} />

        <LangWatchQLParametersEditor
          key={`parameters-${wiring.openedRevision}`}
          onChange={onParametersChange}
          missingParameters={failure.missingParameters}
          reservedParameters={failure.reservedParameters}
          builtinValues={builtinParameterValues({ timeWindow, granularity })}
          {...(wiring.openedParameters
            ? { initialParameters: wiring.openedParameters }
            : {})}
        />
      </Box>
    </Box>
  );
}

/**
 * The step picker, shown only once something has said the statement declares
 * the parameter. Its own component so the read of the result happens once.
 */
function GranularityRow({
  query,
  granularity,
}: {
  query: ReturnType<typeof useLangWatchQLQuery>;
  granularity: ReturnType<typeof useWorkbenchGranularity>;
}) {
  if (!granularity.shown) return null;

  const { ranAt, coarsenedFrom } = ranAtGranularityOf(query.state);
  return (
    <LangWatchQLGranularityPicker
      value={granularity.value}
      onChange={granularity.onChange}
      {...(ranAt !== undefined ? { ranAtSeconds: ranAt } : {})}
      {...(coarsenedFrom !== undefined
        ? { coarsenedFromSeconds: coarsenedFrom }
        : {})}
    />
  );
}

/** The Save and Open toolbar, bound to the workbench's saved-chart wiring. */
function BoundSavedCharts({
  wiring,
  canSave,
}: {
  wiring: ReturnType<typeof useSavedChartWiring>;
  canSave: boolean;
}) {
  const { saved, currentDraft } = wiring;
  return (
    <SavedChartsToolbar
      charts={saved.charts}
      openedChartId={saved.openedChartId}
      openedChartName={saved.openedChartName}
      isSaving={saved.isSaving}
      canSave={canSave}
      onSave={({ name }) =>
        void saved.save({
          draft: currentDraft(),
          ...(name === undefined ? {} : { name }),
        })
      }
      onOpen={(chartId) => void saved.open(chartId)}
      onRename={(input) => void saved.rename(input)}
      onDelete={(chartId) => void saved.remove(chartId)}
      onSaveAsNew={saved.closeOpened}
    />
  );
}

/**
 * What the Chart and Specification tabs are given: the result on screen, or
 * nothing to chart at all.
 *
 * A refusal and a query that has not run yet both hand back `undefined`, which
 * is the tabs offered and empty rather than hidden — the pane decides how that
 * reads. One render function serves both tabs so the specification being
 * edited is a single piece of state however the member looks at it.
 */
function chartArea({
  state,
  registerSpecReader,
  openedRevision,
  editedSpecText,
  onEditedSpecTextChange,
}: {
  state: LangWatchQLRequestState;
  registerSpecReader: (
    read: (() => Record<string, unknown> | undefined) | null,
  ) => void;
  /** Changes when a saved chart is opened, remounting the chart with its spec. */
  openedRevision: number;
  editedSpecText: string | null;
  onEditedSpecTextChange: (text: string | null) => void;
}):
  | ((view: LangWatchQLResultView, openSpecification: () => void) => ReactNode)
  | undefined {
  if (state.outcome?.kind !== "result") return undefined;
  const { result, snapshot } = state.outcome;

  const renderArea = (
    view: LangWatchQLResultView,
    openSpecification: () => void,
  ) => (
    // The lazy boundary, not `LangWatchQLChartMode`: importing that here
    // would put the whole Vega runtime in the entry chunk, and nothing
    // would look wrong (vegaLazyBoundary.unit.test.ts is what would).
    <LazyLangWatchQLChartMode
      key={`chart-${openedRevision}`}
      result={result}
      submittedLabel={chartResultLabel(snapshot.sql)}
      view={view === "specification" ? "specification" : "chart"}
      onOpenSpecification={openSpecification}
      registerSpecReader={registerSpecReader}
      editedSpecText={editedSpecText}
      onEditedSpecTextChange={onEditedSpecTextChange}
    />
  );
  return renderArea;
}
