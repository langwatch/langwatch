import { Box, Button, HStack, Kbd, Spinner, Text } from "@chakra-ui/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import {
  isLangWatchQLSurfaceParameter,
  type LangWatchQLGranularityStep,
  LWQL_GRANULARITY_STEPS,
  LWQL_PERIOD_GRANULARITY_PARAMETER,
} from "@langwatch/analytics-contract";

import type { LangWatchQLParameterValue } from "../../model/lwql-request-state";
import {
  isLangWatchQLResultStale,
  type LangWatchQLActionLabel,
  type LangWatchQLRequestState,
  type LangWatchQLTimeWindowValues,
} from "../../model/lwql-request-state";
import {
  type LangWatchQLEditorMarker,
  LWQL_PARAMETER_MISSING_CODE,
  LWQL_RESERVED_PARAMETER_SUPPLIED_CODE,
  lwqlEditorMarkers,
  readLangWatchQLFailure,
} from "../../model/lwql-failure";
import type { LangWatchQLSchemaModel } from "../../model/lwql-schema-model";
import {
  LangWatchQLParametersEditor,
  type LangWatchQLParametersChange,
} from "../elements/langwatch-ql-parameters-editor";
import { LangWatchQLEditor } from "./langwatch-ql-editor";
import { LangWatchQLGranularityPicker } from "../elements/langwatch-ql-granularity-picker";
import {
  LangWatchQLResultPane,
  type LangWatchQLResultView,
} from "../blocks/langwatch-ql-result-pane";
import { LangWatchQLSchemaBrowser } from "../elements/langwatch-ql-schema-browser";
import { LangWatchQLTimeWindowEditor } from "../elements/langwatch-ql-time-window-editor";

export interface LangWatchQLWorkbenchQuery {
  readonly state: LangWatchQLRequestState;
  readonly actionLabel: LangWatchQLActionLabel;
  readonly setSql: (sql: string) => void;
  readonly setParameters: (parameters: Readonly<Record<string, LangWatchQLParameterValue>>) => void;
  readonly setTimeWindow: (timeWindow: LangWatchQLTimeWindowValues | undefined) => void;
  /**
   * The bucketing step the next submission carries, or `undefined` for a
   * statement that does not declare one. Surface-owned exactly like the
   * window: sending it for a statement that never asked makes it a reserved
   * value the backend refuses.
   */
  readonly setGranularity: (granularitySeconds: LangWatchQLGranularityStep | undefined) => void;
  readonly runQuery: () => void;
  readonly cancelQuery: () => void;
}

export interface LangWatchQLWorkbenchSchema {
  readonly model: LangWatchQLSchemaModel;
  readonly isLoading: boolean;
  readonly error: unknown;
}

export interface LangWatchQLWorkbenchDraft {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, LangWatchQLParameterValue>>;
  readonly vegaLiteSpec?: Record<string, unknown>;
}

export interface LangWatchQLWorkbenchChart {
  readonly view: LangWatchQLResultView;
  readonly openSpecification: () => void;
  readonly result: Extract<LangWatchQLRequestState["outcome"], { kind: "result" }>["result"];
  readonly submittedLabel: string;
  readonly editedSpecText: string | null;
  readonly onEditedSpecTextChange: (text: string | null) => void;
}

/**
 * Portable workbench composition. The host supplies transport state/actions,
 * its error treatment, and the lazily-loaded chart as narrow render ports.
 */
export interface LangWatchQLWorkbenchProps {
  readonly schema: LangWatchQLWorkbenchSchema;
  readonly query: LangWatchQLWorkbenchQuery;
  readonly pageTimeWindow: LangWatchQLTimeWindowValues;
  readonly editorTheme?: "vs" | "vs-dark";
  readonly initialParameters?: Readonly<Record<string, LangWatchQLParameterValue>>;
  readonly openedRevision?: number;
  readonly openedSpecText?: string;
  readonly renderChart: (chart: LangWatchQLWorkbenchChart) => ReactNode;
  readonly renderToolbar?: (input: {
    canSave: boolean;
    draft: LangWatchQLWorkbenchDraft;
  }) => ReactNode;
  readonly renderError?: (error: unknown, fallbackTitle: string) => ReactNode;
}

interface FailureView {
  readonly markers: readonly LangWatchQLEditorMarker[];
  readonly missingParameters: readonly string[];
  readonly reservedParameters: readonly string[];
  /**
   * Whether the last refusal said the statement declares the granularity step
   * and nothing supplied one. True only after such a refusal, which is every
   * granularity statement's first submission.
   */
  readonly awaitsGranularity: boolean;
}

const NO_FAILURE_VIEW: FailureView = {
  markers: [],
  missingParameters: [],
  reservedParameters: [],
  awaitsGranularity: false,
};

/**
 * Splits the names a missing-parameter refusal listed into the ones a member
 * can actually fill in and the reserved ones they cannot.
 *
 * A reserved name reaching that list is not a member's omission: it is the
 * surface's own to supply, and the granularity step's arrives on the very first
 * run of a statement that declares it. Prompting for it sends the member to a
 * form where typing the name is itself refused — a catch-22 with no third move,
 * which is exactly what this split removes. The step gets its own control.
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
  if (state.outcome?.kind !== "error" || isLangWatchQLResultStale(state)) return NO_FAILURE_VIEW;
  const failure = readLangWatchQLFailure(state.outcome.error);
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
      failure.code === LWQL_RESERVED_PARAMETER_SUPPLIED_CODE ? failure.parameters : [],
    // A refusal naming the step is the only way the workbench learns a
    // statement declares it before anything has successfully run.
    awaitsGranularity: missing.reserved.includes(LWQL_PERIOD_GRANULARITY_PARAMETER),
  };
}

/**
 * The step the visible answer was bucketed at, when it reports one.
 *
 * Read off the result because only the backend parses the statement.
 * Staleness is not consulted, because choosing a step is itself what makes the
 * visible result stale — and the note this feeds describes the answer on
 * screen, which is exactly the stale one.
 */
function ranAtGranularityOf(state: LangWatchQLRequestState): {
  ranAt?: number;
  coarsenedFrom?: number;
} {
  if (state.outcome?.kind !== "result") return {};
  const { result } = state.outcome;
  return {
    ...(result.granularitySeconds !== undefined ? { ranAt: result.granularitySeconds } : {}),
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
 * Deliberately NOT filtered by staleness, unlike the markers. The step is part
 * of the draft, so choosing one makes the visible result stale by definition;
 * hiding the picker on that basis would retract the very control that was just
 * used. Staleness governs what a result *claims*, not whether the control that
 * produced it exists.
 */
function granularityDeclaredBy(
  state: LangWatchQLRequestState,
  awaitsGranularity: boolean,
): boolean | undefined {
  if (awaitsGranularity) return true;
  if (state.outcome?.kind === "result") return state.outcome.result.followsGranularity;
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
 * carries must still be the same number, so `run` writes the shown step —
 * chosen or default — into the draft at the moment Run is pressed, when
 * staling the refusal is exactly what running does anyway.
 */
function useWorkbenchGranularity({
  query,
  declared,
  openedRevision,
}: {
  query: LangWatchQLWorkbenchQuery;
  /** What the last answer said, or `undefined` when it said nothing. */
  declared: boolean | undefined;
  /** Bumped whenever a saved chart is opened. */
  openedRevision: number;
}) {
  const coarsest = LWQL_GRANULARITY_STEPS[LWQL_GRANULARITY_STEPS.length - 1] ?? 3600;
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
  if (declared !== undefined && ranRevision === openedRevision && declared !== on) {
    setShown({ revision: openedRevision, on: declared });
  } else if (shown.revision !== openedRevision) {
    setShown({ revision: openedRevision, on: false });
  }

  const chosenStep = chosen !== null && chosen.revision === openedRevision ? chosen.step : null;
  const value = chosenStep ?? coarsest;

  const { setGranularity } = query;
  // Cleared while the statement does not declare the parameter: sending a step
  // for a statement that never asked for one makes it a reserved value the
  // backend refuses.
  useEffect(() => {
    setGranularity(on && chosenStep !== null ? chosenStep : undefined);
  }, [setGranularity, on, chosenStep]);

  const onChange = useCallback(
    (step: LangWatchQLGranularityStep) => setChosen({ revision: openedRevision, step }),
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
 * The step picker, shown only once something has said the statement declares
 * the parameter. Its own component so the read of the result happens once.
 */
function GranularityRow({
  state,
  granularity,
}: {
  state: LangWatchQLRequestState;
  granularity: ReturnType<typeof useWorkbenchGranularity>;
}) {
  if (!granularity.shown) return null;

  const { ranAt, coarsenedFrom } = ranAtGranularityOf(state);
  return (
    <LangWatchQLGranularityPicker
      value={granularity.value}
      onChange={granularity.onChange}
      {...(ranAt !== undefined ? { ranAtSeconds: ranAt } : {})}
      {...(coarsenedFrom !== undefined ? { coarsenedFromSeconds: coarsenedFrom } : {})}
    />
  );
}

function chartResultLabel(sql: string): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}…` : collapsed;
}

function parseSpecText(text: string | null | undefined): Record<string, unknown> | undefined {
  if (text === null || text === void 0) return void 0;

  try {
    const parsed: unknown = JSON.parse(text);
    const record = z.record(z.string(), z.unknown()).safeParse(parsed);
    return record.success ? record.data : void 0;
  } catch {
    return void 0;
  }
}

function useDraftInsert(query: LangWatchQLWorkbenchQuery, exampleSql: string | undefined) {
  const insertRef = useRef<((text: string) => void) | null>(null);
  const registerInsert = useCallback((insert: ((text: string) => void) | null) => {
    insertRef.current = insert;
  }, []);
  const insert = useCallback(
    (text: string) => {
      if (insertRef.current) return insertRef.current(text);
      query.setSql(
        query.state.draft.sql.length === 0
          ? text
          : `${query.state.draft.sql}${query.state.draft.sql.endsWith("\n") ? "" : "\n"}${text}`,
      );
    },
    [query],
  );
  return {
    registerInsert,
    insertExample: exampleSql === void 0 ? void 0 : () => insert(exampleSql),
    insert,
  };
}

function useTimeWindow(
  query: LangWatchQLWorkbenchQuery,
  pageTimeWindow: LangWatchQLTimeWindowValues,
  openedRevision: number,
) {
  const { setTimeWindow } = query;
  const [override, setOverride] = useState<{
    revision: number;
    value: LangWatchQLTimeWindowValues;
  } | null>(null);
  const [sendable, setSendable] = useState(true);
  const held = override?.revision === openedRevision ? override.value : void 0;
  const value = held ?? pageTimeWindow;
  useEffect(() => setTimeWindow(value), [setTimeWindow, value]);
  return {
    value,
    overridden: held !== void 0,
    sendable,
    onSendableChange: setSendable,
    onOverride: (next: LangWatchQLTimeWindowValues) =>
      setOverride({ revision: openedRevision, value: next }),
    onFollowPage: () => setOverride(null),
  };
}

export function LangWatchQLWorkbench({
  schema,
  query,
  pageTimeWindow,
  editorTheme = "vs",
  initialParameters,
  openedRevision = 0,
  openedSpecText,
  renderChart,
  renderToolbar,
  renderError,
}: LangWatchQLWorkbenchProps) {
  const [schemaVisible, setSchemaVisible] = useState(true);
  const [parametersSendable, setParametersSendable] = useState(true);
  const [specDraft, setSpecDraft] = useState<{
    revision: number;
    text: string | null | undefined;
  }>({ revision: openedRevision, text: void 0 });
  useEffect(() => setParametersSendable(true), [openedRevision]);
  const failure = useMemo(() => failureView(query.state), [query.state]);
  const { registerInsert, insertExample, insert } = useDraftInsert(
    query,
    schema.model.datasets[0]?.exampleSql,
  );
  const timeWindow = useTimeWindow(query, pageTimeWindow, openedRevision);
  const granularity = useWorkbenchGranularity({
    query,
    declared: granularityDeclaredBy(query.state, failure.awaitsGranularity),
    openedRevision,
  });
  const editedSpecText = specDraft.revision === openedRevision ? specDraft.text : void 0;
  const shownSpecText = editedSpecText === void 0 ? (openedSpecText ?? null) : editedSpecText;
  const onEditedSpecTextChange = useCallback(
    (text: string | null) => setSpecDraft({ revision: openedRevision, text }),
    [openedRevision],
  );
  const onParametersChange = useCallback(
    ({ parameters, sendable }: LangWatchQLParametersChange) => {
      query.setParameters(parameters);
      setParametersSendable(sendable);
    },
    [query],
  );
  const followsTimeWindow =
    query.state.outcome?.kind === "result" && !isLangWatchQLResultStale(query.state)
      ? query.state.outcome.result.followsTimeWindow
      : void 0;
  const vegaLiteSpec = parseSpecText(shownSpecText);
  const draft = {
    sql: query.state.draft.sql,
    parameters: query.state.draft.parameters,
    ...(vegaLiteSpec ? { vegaLiteSpec } : {}),
  };
  const result = query.state.outcome?.kind === "result" ? query.state.outcome : void 0;

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
            onInsert={insert}
            renderError={
              renderError ? (error) => renderError(error, "Couldn't load the schema") : void 0
            }
          />
        </Box>
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
        <Box
          flexShrink={0}
          background="bg.panel"
          borderWidth="1px"
          borderColor="border"
          borderRadius="10px"
          boxShadow="xs"
          overflow="hidden"
        >
          <HStack gap={2} paddingX={3} paddingY={2} borderBottomWidth="1px" borderColor="border">
            <Button
              size="xs"
              variant="ghost"
              aria-label={schemaVisible ? "Hide the schema" : "Show the schema"}
              onClick={() => setSchemaVisible((value) => !value)}
            >
              <Box aria-hidden="true" display="flex">
                {schemaVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
              </Box>
            </Button>
            <Text fontSize="13px" fontWeight="600">
              Query
            </Text>
            <Box flex="1" />
            {renderToolbar?.({ canSave: query.state.draft.sql.trim().length > 0, draft })}
            <Kbd size="sm" aria-hidden="true">
              ⌘⏎
            </Kbd>
            {query.state.isInFlight ? (
              <>
                <Button size="sm" variant="outline" onClick={query.cancelQuery}>
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
                disabled={
                  query.state.draft.sql.trim().length === 0 ||
                  !parametersSendable ||
                  !timeWindow.sendable
                }
                onClick={granularity.run}
              >
                {query.actionLabel}
              </Button>
            )}
          </HStack>
          <LangWatchQLEditor
            sql={query.state.draft.sql}
            onChange={query.setSql}
            schema={schema.model}
            markers={failure.markers}
            registerInsert={registerInsert}
            onRun={granularity.run}
            theme={editorTheme}
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
              followsTimeWindow={followsTimeWindow}
              onSendableChange={timeWindow.onSendableChange}
            />
            <GranularityRow state={query.state} granularity={granularity} />
            <LangWatchQLParametersEditor
              key={`parameters-${openedRevision}`}
              onChange={onParametersChange}
              missingParameters={failure.missingParameters}
              reservedParameters={failure.reservedParameters}
              {...(initialParameters ? { initialParameters } : {})}
            />
          </Box>
        </Box>
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
            onRun={granularity.run}
            {...(insertExample ? { onInsertExample: insertExample } : {})}
            renderError={renderError}
            renderChartArea={
              result
                ? (view, openSpecification) =>
                    renderChart({
                      view,
                      openSpecification,
                      result: result.result,
                      submittedLabel: chartResultLabel(result.snapshot.sql),
                      editedSpecText: shownSpecText,
                      onEditedSpecTextChange,
                    })
                : void 0
            }
          />
        </Box>
      </Box>
    </HStack>
  );
}
