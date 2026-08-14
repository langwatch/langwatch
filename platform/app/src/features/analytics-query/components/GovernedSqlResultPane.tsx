/**
 * What came back from the last submission.
 *
 * Every failure is presented through the code-keyed registry: the wire message
 * of a handled error is its code, so rendering it would put `query_timeout` in
 * front of a customer. What this adds on top of the registry copy is the
 * structured detail the backend gave for that specific code, and nothing else.
 *
 * A result whose draft has moved on is labelled, never hidden and never
 * presented as current. Reading an old table while writing the next query is
 * normal; being unable to tell which query produced it is the bug.
 *
 * ## Result views
 *
 * Table, Chart and Specification are three readings of one already-fetched
 * result, so switching between them is local state and nothing else — this
 * component takes the result as a prop and owns no query. Chart and
 * Specification are rendered through {@link
 * GovernedSqlResultPaneProps.renderChartArea}: one render function for both, so
 * the specification being edited is a single piece of state however the member
 * looks at it. The area is mounted on the first visit to either view and kept
 * mounted (hidden) afterwards — mounting is what loads the Vega runtime, and
 * unmounting is what would throw away an edited specification.
 *
 * The statistics and diagnostics live below the views, because they belong to
 * the result rather than to any reading of it. Keeping them outside the view
 * panels is what makes "a truncation warning is visible in every view" true by
 * construction rather than by remembering to repeat it.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see specs/analytics/governed-sql-workbench.feature
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  Spinner,
  Stack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type ReactNode, useId, useState } from "react";

import { HandledErrorAlert } from "~/features/errors";
import type { GovernedSqlQueryResult } from "~/server/analytics/governed-sql";
import { formatNumber } from "~/utils/formatNumber";

import {
  GOVERNED_SQL_TIMEOUT_CODE,
  GOVERNED_SQL_UNPARSEABLE_CODE,
  type GovernedSqlFailure,
  readGovernedSqlFailure,
} from "../logic/governedSqlFailure";
import {
  type GovernedSqlRequestState,
  isGovernedSqlResultStale,
} from "../logic/governedSqlRequestState";
import { GovernedSqlDiagnostics } from "./GovernedSqlDiagnostics";
import { GovernedSqlResultMeta } from "./GovernedSqlResultMeta";
import { GovernedSqlResultTable } from "./GovernedSqlResultTable";

/** The three readings of a result. */
export type GovernedSqlResultView = "table" | "chart" | "specification";

/** The view a first successful result opens in. */
const DEFAULT_RESULT_VIEW: GovernedSqlResultView = "table";

export interface GovernedSqlResultPaneProps {
  state: GovernedSqlRequestState;
  /** Submits the draft. The stale notice offers it as "run the new draft". */
  onRun: () => void;
  /** Writes an example statement into the editor, when the schema offers one. */
  onInsertExample?: () => void;
  /**
   * Chart and Specification content, supplied by whoever owns the chart.
   * Called with the active view and a way to switch to the Specification view;
   * absent, both views are offered and empty rather than hidden.
   */
  renderChartArea?: (
    view: GovernedSqlResultView,
    openSpecification: () => void,
  ) => ReactNode;
}

/**
 * One word for where the visible answer stands, worn as a pill in the result
 * header. The title carries the sentence the word abbreviates.
 */
interface ResultChip {
  readonly label: string;
  readonly palette: "green" | "orange" | "red";
  readonly title: string;
}

function resultChip({
  state,
  failure,
  isStale,
}: {
  state: GovernedSqlRequestState;
  failure: GovernedSqlFailure | undefined;
  isStale: boolean;
}): ResultChip | undefined {
  if (state.outcome?.kind === "error" && failure) {
    return failure.code === GOVERNED_SQL_TIMEOUT_CODE
      ? {
          label: "Timed out",
          palette: "orange",
          title: "The database stopped the read at its time ceiling",
        }
      : {
          label: "Refused",
          palette: "red",
          title: "The server refused this statement before reading any data",
        };
  }
  if (state.outcome?.kind !== "result") return undefined;
  if (isStale) {
    return {
      label: "Previous submission",
      palette: "orange",
      title:
        "The visible result belongs to the statement as it was when it ran",
    };
  }
  if (state.outcome.result.truncated) {
    return {
      label: "Partial",
      palette: "orange",
      title: "The response ceiling cut this result short",
    };
  }
  return {
    label: "Current",
    palette: "green",
    title: "This result matches the draft in the editor",
  };
}

/**
 * The refusal's own reasons, under the registry copy.
 *
 * This is the one place the workbench reads `meta`, and it clears the bar the
 * error-handling contract sets for that: the shape is declared by the API
 * (`GovernedSqlViolation`), every message is customer-safe by construction, and
 * this pane is the named consumer. Without them a policy refusal would say
 * "this query isn't allowed here" and leave the member guessing which of five
 * joins to change.
 *
 * @see ~/server/analytics/governed-sql/validation/violations.ts
 */
function ViolationList({ failure }: { failure: GovernedSqlFailure }) {
  if (failure.violations.length === 0) return null;

  return (
    <Stack gap={2}>
      {failure.violations.map((violation, index) => (
        <HStack
          key={`${violation.code}-${index}`}
          align="flex-start"
          gap={3}
          borderWidth="1px"
          borderColor="border"
          borderRadius="8px"
          background="red.subtle"
          paddingX={3}
          paddingY={2}
        >
          {violation.at && (
            <Text
              fontFamily="mono"
              fontSize="11.5px"
              fontWeight="700"
              color="red.fg"
              flexShrink={0}
            >
              line {violation.at.line} : {violation.at.column}
            </Text>
          )}
          <Text fontSize="12.5px" lineHeight="1.55">
            {violation.message}
          </Text>
        </HStack>
      ))}
    </Stack>
  );
}

function StaleNotice({ onRun }: { onRun: () => void }) {
  return (
    <Text
      fontSize="12.5px"
      color="fg.muted"
      data-testid="governed-sql-stale-notice"
      role="status"
    >
      The statement changed after this ran —{" "}
      <Button
        variant="plain"
        size="xs"
        height="auto"
        padding={0}
        fontSize="12.5px"
        fontWeight="600"
        color="orange.fg"
        textDecoration="underline"
        onClick={onRun}
      >
        run the new draft
      </Button>
    </Text>
  );
}

/**
 * How much of the answer arrived, in the only number that is always true.
 *
 * It cites the rows actually returned and never a row ceiling, because the
 * ceiling is usually not what bit: a response is also capped by a byte budget,
 * so a wide result is commonly cut off in the hundreds. Naming "10,000" here
 * would tell a member their query hit a limit it never reached, and send them
 * looking for ten thousand rows that were never coming.
 *
 * @see ~/server/analytics/governed-sql/executor.ts — the two ceilings
 */
function TruncationBanner({ result }: { result: GovernedSqlQueryResult }) {
  return (
    <HStack
      gap={2}
      align="flex-start"
      role="status"
      data-testid="governed-sql-truncation-banner"
      background="orange.subtle"
      borderBottomWidth="1px"
      borderColor="border"
      paddingX={4}
      paddingY={2}
    >
      <Text fontSize="12px" fontWeight="700" color="orange.fg" flexShrink={0}>
        Partial result
      </Text>
      <Text fontSize="12px" color="fg.muted" lineHeight="1.5">
        Showing the first {formatNumber(result.statistics.rowsReturned)} rows.
        The rest of the answer did not fit in the response — aggregate or narrow
        the query to see it.
      </Text>
    </HStack>
  );
}

/** Nothing has run yet. The workbench's front door, not an error. */
function EmptyState({ onInsertExample }: { onInsertExample?: () => void }) {
  return (
    <VStack
      flex="1"
      justify="center"
      align="center"
      padding={8}
      textAlign="center"
      gap={0}
    >
      <Text
        fontFamily="mono"
        fontSize="24px"
        color="fg.subtle"
        marginBottom={3}
        aria-hidden="true"
      >
        SELECT …
      </Text>
      <Text fontSize="14px" fontWeight="600" marginBottom={1}>
        Nothing has run yet
      </Text>
      <Text
        fontSize="12.5px"
        color="fg.muted"
        lineHeight="1.6"
        maxWidth="420px"
      >
        The governed datasets on the left are ready — open one to see what a row
        means and what you can select. Nothing runs until you press{" "}
        <strong>Run query</strong>.
      </Text>
      {onInsertExample && (
        <Button
          size="sm"
          colorPalette="orange"
          marginTop={4}
          onClick={onInsertExample}
        >
          Start from an example
        </Button>
      )}
    </VStack>
  );
}

/** A first request in flight, with nothing older to keep on screen. */
function RunningState() {
  return (
    <VStack
      flex="1"
      justify="center"
      align="center"
      padding={8}
      gap={2}
      data-testid="governed-sql-loading"
    >
      <Spinner size="sm" color="orange.solid" />
      <Text fontSize="12.5px" color="fg.muted">
        Validating, scoping to this project, and reading…
      </Text>
      <Text fontSize="11px" color="fg.subtle">
        Cancel keeps the previous result untouched.
      </Text>
    </VStack>
  );
}

/** The pill strip that switches between readings of the result. */
function ViewTabs({
  view,
  onViewChange,
  panelIdFor,
}: {
  view: GovernedSqlResultView;
  onViewChange: (view: GovernedSqlResultView) => void;
  /**
   * The panel a tab controls, or `undefined` while that panel is not in the
   * document — a tab pointing at a missing id reads to a screen reader as a
   * broken tab relation, which is worse than no relation at all.
   */
  panelIdFor: (view: GovernedSqlResultView) => string | undefined;
}) {
  const entries: readonly { value: GovernedSqlResultView; label: string }[] = [
    { value: "table", label: "Table" },
    { value: "chart", label: "Chart" },
    { value: "specification", label: "Specification" },
  ];

  return (
    <HStack
      role="tablist"
      aria-label="Result view"
      gap={0}
      padding="2px"
      background="bg.subtle"
      borderWidth="1px"
      borderColor="border"
      borderRadius="7px"
    >
      {entries.map((entry) => {
        const selected = entry.value === view;
        const panelId = panelIdFor(entry.value);
        return (
          <Button
            key={entry.value}
            role="tab"
            aria-selected={selected}
            {...(panelId ? { "aria-controls": panelId } : {})}
            size="xs"
            height="24px"
            variant="plain"
            borderRadius="5px"
            fontWeight="600"
            background={selected ? "bg.panel" : "transparent"}
            color={selected ? "fg" : "fg.muted"}
            boxShadow={selected ? "xs" : "none"}
            onClick={() => onViewChange(entry.value)}
          >
            {entry.label}
          </Button>
        );
      })}
    </HStack>
  );
}

export function GovernedSqlResultPane({
  state,
  onRun,
  onInsertExample,
  renderChartArea,
}: GovernedSqlResultPaneProps) {
  const [view, setView] = useState<GovernedSqlResultView>(DEFAULT_RESULT_VIEW);
  // Mounting the chart area is what loads the Vega runtime, so it waits for
  // the first visit to Chart or Specification — and then stays mounted, hidden,
  // because unmounting would throw away an edited specification.
  const [chartAreaVisited, setChartAreaVisited] = useState(false);
  const panelIdBase = useId();
  const hasChartPanel = renderChartArea !== undefined && chartAreaVisited;
  // Chart and Specification are two readings hosted by one panel: the chart
  // area stays mounted across the switch so an edited specification survives
  // it. Both tabs therefore name that one panel, and name nothing at all until
  // the first visit puts it in the document.
  const panelIdFor = (target: GovernedSqlResultView): string | undefined => {
    if (target === "table") return `${panelIdBase}-table`;
    return hasChartPanel ? `${panelIdBase}-chart-area` : undefined;
  };

  const { isStale, failure, result, chip } = readPaneModel(state);

  const changeView = (next: GovernedSqlResultView) => {
    if (next !== "table") setChartAreaVisited(true);
    setView(next);
  };
  const openSpecification = () => changeView("specification");

  if (state.outcome === null) {
    return (
      <NoOutcomePane
        isInFlight={state.isInFlight}
        onInsertExample={onInsertExample}
      />
    );
  }

  return (
    <VStack
      align="stretch"
      flex="1"
      minHeight={0}
      gap={0}
      // When the viewport is too short for the chart floor plus the footer,
      // the pane scrolls as a whole rather than clipping either.
      overflowY="auto"
      data-testid="governed-sql-result-pane"
    >
      <ResultHeader
        tabs={
          result ? (
            <ViewTabs
              view={view}
              onViewChange={changeView}
              panelIdFor={panelIdFor}
            />
          ) : undefined
        }
        chip={chip}
        isStale={isStale}
        onRun={onRun}
        isInFlight={state.isInFlight}
      />

      {state.outcome.kind === "error" && failure && (
        <FailureBlock error={state.outcome.error} failure={failure} />
      )}

      {result && (
        <ResultBody
          result={result}
          view={view}
          panelIdBase={panelIdBase}
          chartArea={
            renderChartArea && chartAreaVisited
              ? renderChartArea(view, openSpecification)
              : undefined
          }
        />
      )}
    </VStack>
  );
}

/** What the last submission left to show, read once per render. */
function readPaneModel(state: GovernedSqlRequestState) {
  const isStale = isGovernedSqlResultStale(state);
  const failure =
    state.outcome?.kind === "error"
      ? readGovernedSqlFailure(state.outcome.error)
      : undefined;
  const result =
    state.outcome?.kind === "result" ? state.outcome.result : undefined;
  return {
    isStale,
    failure,
    result,
    chip: resultChip({ state, failure, isStale }),
  };
}

/** Before any outcome exists: the first run in flight, or the untouched pane. */
function NoOutcomePane({
  isInFlight,
  onInsertExample,
}: {
  isInFlight: boolean;
  onInsertExample: (() => void) | undefined;
}) {
  return (
    <VStack
      align="stretch"
      flex="1"
      minHeight={0}
      gap={0}
      data-testid="governed-sql-result-pane"
    >
      {isInFlight ? (
        <RunningState />
      ) : (
        <EmptyState {...(onInsertExample ? { onInsertExample } : {})} />
      )}
    </VStack>
  );
}

function ResultHeader({
  tabs,
  chip,
  isStale,
  onRun,
  isInFlight,
}: {
  tabs: ReactNode | undefined;
  chip: ResultChip | undefined;
  isStale: boolean;
  onRun: () => void;
  isInFlight: boolean;
}) {
  return (
    <HStack
      gap={3}
      paddingX={3}
      paddingY={2}
      borderBottomWidth="1px"
      borderColor="border"
      flexShrink={0}
    >
      {tabs}
      {chip && <ResultChipBadge chip={chip} />}
      {isStale && <StaleNotice onRun={onRun} />}
      <Box flex="1" />
      {isInFlight && (
        <HStack gap={2} color="fg.muted" data-testid="governed-sql-loading">
          <Spinner size="xs" />
          <Text fontSize="12px">Running…</Text>
        </HStack>
      )}
    </HStack>
  );
}

function ResultChipBadge({ chip }: { chip: ResultChip }) {
  return (
    <Badge
      size="sm"
      variant="subtle"
      colorPalette={chip.palette}
      borderRadius="full"
      title={chip.title}
      data-testid="governed-sql-result-chip"
    >
      {chip.label}
    </Badge>
  );
}

function FailureBlock({
  error,
  failure,
}: {
  error: unknown;
  failure: GovernedSqlFailure;
}) {
  return (
    <Stack gap={3} padding={5} overflowY="auto">
      <HandledErrorAlert error={error} fallbackTitle="Couldn't run the query" />
      {/* Locations are also marked in the editor; they are repeated here so
          a refusal that names several positions can be read as a list. */}
      <ViolationList failure={failure} />
      {failure.code === GOVERNED_SQL_UNPARSEABLE_CODE &&
        failure.violations.every((violation) => !violation.at) && (
          <Text fontSize="12.5px" color="fg.muted">
            The refusal did not say where in the statement the problem is.
          </Text>
        )}
    </Stack>
  );
}

function ResultBody({
  result,
  view,
  panelIdBase,
  chartArea,
}: {
  result: GovernedSqlQueryResult;
  view: GovernedSqlResultView;
  panelIdBase: string;
  chartArea: ReactNode | undefined;
}) {
  return (
    <>
      {result.truncated && <TruncationBanner result={result} />}

      <Box
        flex="1"
        minHeight={0}
        overflow="auto"
        role="tabpanel"
        id={`${panelIdBase}-table`}
        display={view === "table" ? undefined : "none"}
      >
        <GovernedSqlResultTable result={result} />
      </Box>

      {chartArea !== undefined && (
        <Box
          flex="1"
          // A floor rather than 0: a chart cut off mid-bar reads as broken,
          // so past this the panel scrolls instead of shrinking.
          minHeight="280px"
          overflow="auto"
          role="tabpanel"
          id={`${panelIdBase}-chart-area`}
          display={view === "table" ? "none" : undefined}
          padding={view === "specification" ? 0 : 4}
        >
          {chartArea}
        </Box>
      )}

      <Box borderTopWidth="1px" borderColor="border" flexShrink={0}>
        <GovernedSqlDiagnostics diagnostics={result.diagnostics} />
        <GovernedSqlResultMeta statistics={result.statistics} />
      </Box>
    </>
  );
}
