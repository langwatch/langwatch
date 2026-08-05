/**
 * The governed SQL workbench: schema on the left, editor and result on the
 * right.
 *
 * It composes and wires; it decides nothing about SQL. The statement is handed
 * to the endpoint exactly as typed, and everything the member is told about it
 * afterwards is the backend's answer rendered through the error registry.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { useGovernedSqlQuery } from "../hooks/useGovernedSqlQuery";
import { useGovernedSqlSchema } from "../hooks/useGovernedSqlSchema";
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
import { GovernedSqlResultPane } from "./GovernedSqlResultPane";
import { LazyGovernedSqlChartMode } from "./LazyGovernedSqlChartMode";

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
 * Names the editor and carries the one action that talks to the server.
 *
 * The action's label is the request state's own answer, so what the button says
 * and what pressing it does can never disagree.
 */
function WorkbenchToolbar({
  schemaVisible,
  onToggleSchema,
  actionLabel,
  runnable,
  onRun,
}: {
  schemaVisible: boolean;
  onToggleSchema: () => void;
  actionLabel: string;
  runnable: boolean;
  onRun: () => void;
}) {
  return (
    <HStack gap={2}>
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
        Governed ClickHouse SQL
      </Text>
      <Box flex="1" />
      <Button
        size="sm"
        colorPalette="orange"
        disabled={!runnable}
        onClick={onRun}
      >
        {actionLabel}
      </Button>
    </HStack>
  );
}

export function GovernedSqlWorkbench({ projectId }: GovernedSqlWorkbenchProps) {
  const schema = useGovernedSqlSchema({ projectId });
  const query = useGovernedSqlQuery({ projectId });

  const [schemaVisible, setSchemaVisible] = useState(true);

  // The editor hands back a writer once Monaco has mounted. Until then, and in
  // any environment without it, an insert appends to the draft instead of
  // silently doing nothing.
  const insertRef = useRef<((text: string) => void) | null>(null);
  const registerInsert = useCallback(
    (insert: ((text: string) => void) | null) => {
      insertRef.current = insert;
    },
    [],
  );

  const { draft } = query.state;
  const { setSql } = query;
  const failure = useMemo(() => failureView(query.state), [query.state]);

  const handleInsert = useCallback(
    (text: string) => {
      const insert = insertRef.current;
      if (insert) return insert(text);

      const current = draft.sql;
      setSql(
        current.length === 0
          ? text
          : `${current}${current.endsWith("\n") ? "" : "\n"}${text}`,
      );
    },
    [draft.sql, setSql],
  );

  return (
    <HStack
      align="stretch"
      gap={4}
      width="full"
      data-testid="governed-sql-workbench"
    >
      {schemaVisible && (
        <Box width="320px" flexShrink={0} overflowY="auto">
          <GovernedSchemaBrowser
            model={schema.model}
            isLoading={schema.isLoading}
            error={schema.error}
            onInsert={handleInsert}
          />
        </Box>
      )}

      <VStack align="stretch" gap={3} flex="1" minWidth={0}>
        <WorkbenchToolbar
          schemaVisible={schemaVisible}
          onToggleSchema={() => setSchemaVisible((visible) => !visible)}
          actionLabel={query.actionLabel}
          runnable={draft.sql.trim().length > 0 && !query.state.inFlight}
          // Always the draft, under either label. When the label reads
          // "Reload" the draft is byte-identical to what produced the visible
          // result, so this IS a reload — and unlike `reload()` it can never
          // re-send a superseded submission the member is no longer looking at.
          onRun={query.runQuery}
        />

        <GovernedSqlEditor
          sql={draft.sql}
          onChange={setSql}
          schema={schema.model}
          markers={failure.markers}
          registerInsert={registerInsert}
        />

        <GovernedSqlParametersEditor
          onChange={query.setParameters}
          missingParameters={failure.missingParameters}
        />

        <GovernedSqlResultPane
          state={query.state}
          // The lazy boundary, not `GovernedSqlChartMode`: importing that here
          // would put the whole Vega runtime in the entry chunk, and nothing
          // would look wrong (vegaLazyBoundary.unit.test.ts is what would).
          chartSlot={
            query.state.outcome?.kind === "result" ? (
              <LazyGovernedSqlChartMode
                result={query.state.outcome.result}
                submittedLabel={chartResultLabel(query.state.outcome.snapshot.sql)}
              />
            ) : undefined
          }
        />
      </VStack>
    </HStack>
  );
}
