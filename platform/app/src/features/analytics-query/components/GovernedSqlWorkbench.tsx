/**
 * The governed SQL workbench: schema on the left, editor and result on the
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
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Box, Button, HStack, Kbd, Spinner, Text } from "@chakra-ui/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import { useGovernedSqlQuery } from "../hooks/useGovernedSqlQuery";
import { useGovernedSqlSchema } from "../hooks/useGovernedSqlSchema";
import { useSavedChartWiring } from "../hooks/useSavedChartWiring";
import {
  GOVERNED_SQL_PARAMETER_MISSING_CODE,
  type GovernedSqlEditorMarker,
  governedSqlEditorMarkers,
  readGovernedSqlFailure,
} from "../logic/governedSqlFailure";
import {
  type GovernedSqlRequestState,
  isGovernedSqlResultStale,
} from "../logic/governedSqlRequestState";

import { GovernedSchemaBrowser } from "./GovernedSchemaBrowser";
import { GovernedSqlEditor } from "./GovernedSqlEditor";
import { GovernedSqlParametersEditor } from "./GovernedSqlParametersEditor";
import {
  GovernedSqlResultPane,
  type GovernedSqlResultView,
} from "./GovernedSqlResultPane";
import { LazyGovernedSqlChartMode } from "./LazyGovernedSqlChartMode";
import { SavedChartsToolbar } from "./SavedChartsToolbar";

/** What a refusal gives the editor and the parameters form to work with. */
interface FailureView {
  readonly markers: readonly GovernedSqlEditorMarker[];
  readonly missingParameters: readonly string[];
}

/** Stable identity, so an unchanged "nothing to report" never re-renders a form. */
const NO_FAILURE_VIEW: FailureView = { markers: [], missingParameters: [] };

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

function failureView(state: GovernedSqlRequestState): FailureView {
  const { outcome } = state;
  if (outcome?.kind !== "error") return NO_FAILURE_VIEW;

  // A refusal belonging to a statement the member has since rewritten must not
  // underline a line of the statement now in the editor, nor name parameters
  // the current draft may no longer declare. The result pane still shows the
  // refusal, labelled as the previous submission's; only the annotations that
  // point AT the buffer are withdrawn.
  if (isGovernedSqlResultStale(state)) return NO_FAILURE_VIEW;

  const failure = readGovernedSqlFailure(outcome.error);
  return {
    markers: governedSqlEditorMarkers(failure),
    // Only this code's names belong on the parameters form; every other
    // refusal is about the statement.
    missingParameters:
      failure.code === GOVERNED_SQL_PARAMETER_MISSING_CODE
        ? failure.missingParameters
        : [],
  };
}

export interface GovernedSqlWorkbenchProps {
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
  inFlight,
  onRun,
  onCancel,
  savedCharts,
}: {
  schemaVisible: boolean;
  onToggleSchema: () => void;
  actionLabel: string;
  runnable: boolean;
  inFlight: boolean;
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
      {inFlight ? (
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
  query: ReturnType<typeof useGovernedSqlQuery>;
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

export function GovernedSqlWorkbench({ projectId }: GovernedSqlWorkbenchProps) {
  const schema = useGovernedSqlSchema({ projectId });
  const query = useGovernedSqlQuery({ projectId });

  const [schemaVisible, setSchemaVisible] = useState(true);
  const { registerInsert, handleInsert, insertExample } = useDraftInsert({
    query,
    exampleSql: schema.model.datasets[0]?.exampleSql,
  });
  const failure = useMemo(() => failureView(query.state), [query.state]);
  const wiring = useSavedChartWiring({ projectId, query });

  return (
    <HStack
      align="stretch"
      gap={0}
      width="full"
      flex="1"
      minHeight={0}
      data-testid="governed-sql-workbench"
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
          schemaModel={schema.model}
          failure={failure}
          registerInsert={registerInsert}
          schemaVisible={schemaVisible}
          onToggleSchema={() => setSchemaVisible((visible) => !visible)}
          wiring={wiring}
        />

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
          <GovernedSqlResultPane
            state={query.state}
            onRun={query.runQuery}
            {...(insertExample ? { onInsertExample: insertExample } : {})}
            renderChartArea={chartArea({
              state: query.state,
              registerSpecReader: wiring.registerSpecReader,
              openedRevision: wiring.openedRevision,
              openedSpecText: wiring.openedSpecText,
            })}
          />
        </Box>
      </Box>
    </HStack>
  );
}

function SchemaSidebar({
  schema,
  onInsert,
}: {
  schema: ReturnType<typeof useGovernedSqlSchema>;
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
      <GovernedSchemaBrowser
        model={schema.model}
        isLoading={schema.isLoading}
        error={schema.error}
        onInsert={onInsert}
      />
    </Box>
  );
}

function QueryCard({
  query,
  schemaModel,
  failure,
  registerInsert,
  schemaVisible,
  onToggleSchema,
  wiring,
}: {
  query: ReturnType<typeof useGovernedSqlQuery>;
  schemaModel: ReturnType<typeof useGovernedSqlSchema>["model"];
  failure: FailureView;
  registerInsert: (insert: ((text: string) => void) | null) => void;
  schemaVisible: boolean;
  onToggleSchema: () => void;
  wiring: ReturnType<typeof useSavedChartWiring>;
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
        runnable={draft.sql.trim().length > 0 && !query.state.inFlight}
        inFlight={query.state.inFlight}
        // Always the draft, under either label. When the label reads
        // "Reload" the draft is byte-identical to what produced the visible
        // result, so this IS a reload — and unlike `reload()` it can never
        // re-send a superseded submission the member is no longer looking
        // at.
        onRun={query.runQuery}
        onCancel={query.cancelQuery}
        savedCharts={
          <BoundSavedCharts
            wiring={wiring}
            savable={draft.sql.trim().length > 0}
          />
        }
      />

      <GovernedSqlEditor
        sql={draft.sql}
        onChange={query.setSql}
        schema={schemaModel}
        markers={failure.markers}
        registerInsert={registerInsert}
        onRun={query.runQuery}
      />

      <Box
        borderTopWidth="1px"
        borderColor="border"
        background="bg.subtle"
        paddingX={3}
        paddingY={2}
      >
        <GovernedSqlParametersEditor
          key={`parameters-${wiring.openedRevision}`}
          onChange={query.setParameters}
          missingParameters={failure.missingParameters}
          {...(wiring.openedParameters
            ? { initialParameters: wiring.openedParameters }
            : {})}
        />
      </Box>
    </Box>
  );
}

/** The Save and Open toolbar, bound to the workbench's saved-chart wiring. */
function BoundSavedCharts({
  wiring,
  savable,
}: {
  wiring: ReturnType<typeof useSavedChartWiring>;
  savable: boolean;
}) {
  const { saved, currentDraft } = wiring;
  return (
    <SavedChartsToolbar
      charts={saved.charts}
      openedChartId={saved.openedChartId}
      openedChartName={saved.openedChartName}
      isSaving={saved.isSaving}
      savable={savable}
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
  openedSpecText,
}: {
  state: GovernedSqlRequestState;
  registerSpecReader: (
    read: (() => Record<string, unknown> | undefined) | null,
  ) => void;
  /** Changes when a saved chart is opened, remounting the chart with its spec. */
  openedRevision: number;
  openedSpecText: string | undefined;
}):
  | ((view: GovernedSqlResultView, openSpecification: () => void) => ReactNode)
  | undefined {
  if (state.outcome?.kind !== "result") return undefined;
  const { result, snapshot } = state.outcome;

  const renderArea = (
    view: GovernedSqlResultView,
    openSpecification: () => void,
  ) => (
    // The lazy boundary, not `GovernedSqlChartMode`: importing that here
    // would put the whole Vega runtime in the entry chunk, and nothing
    // would look wrong (vegaLazyBoundary.unit.test.ts is what would).
    <LazyGovernedSqlChartMode
      key={`chart-${openedRevision}`}
      result={result}
      submittedLabel={chartResultLabel(snapshot.sql)}
      view={view === "specification" ? "specification" : "chart"}
      onOpenSpecification={openSpecification}
      registerSpecReader={registerSpecReader}
      {...(openedSpecText === undefined
        ? {}
        : { initialSpecText: openedSpecText })}
    />
  );
  return renderArea;
}
