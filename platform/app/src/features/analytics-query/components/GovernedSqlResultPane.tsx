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
 * ## Result modes
 *
 * Table and Chart are two readings of one already-fetched result, so switching
 * between them is local state and nothing else — this component takes the
 * result as a prop and owns no query. Chart mode renders {@link
 * GovernedSqlResultPaneProps.chartSlot}; until that slot is supplied the tab is
 * still offered and still carries the statistics and diagnostics below, because
 * those belong to the result rather than to either reading of it. Keeping them
 * outside the tab panels is what makes "a truncation warning is visible in both
 * modes" true by construction rather than by remembering to repeat it.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see specs/analytics/governed-sql-workbench.feature
 */

import {
  Badge,
  Box,
  HStack,
  Spinner,
  Stack,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ReactNode } from "react";

import { HandledErrorAlert } from "~/features/errors";
import type { GovernedSqlQueryResult } from "~/server/analytics/governed-sql";
import { formatNumber } from "~/utils/formatNumber";

import {
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

/** The mode a first successful result opens in. */
const DEFAULT_RESULT_MODE = "table";

export interface GovernedSqlResultPaneProps {
  state: GovernedSqlRequestState;
  /**
   * Chart mode's content, supplied by whoever owns the chart. Absent, Chart
   * mode is offered and empty rather than hidden — the statistics and
   * diagnostics under it are the same either way.
   */
  chartSlot?: ReactNode;
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
    <Stack gap={1} paddingLeft={1}>
      {failure.violations.map((violation, index) => (
        <Box key={`${violation.code}-${index}`}>
          <Text fontSize="12.5px">{violation.message}</Text>
          {violation.at && (
            <Text fontSize="12px" color="fg.muted">
              Line {violation.at.line}, column {violation.at.column}
            </Text>
          )}
        </Box>
      ))}
    </Stack>
  );
}

function StaleNotice() {
  return (
    <HStack
      gap={2}
      align="center"
      data-testid="governed-sql-stale-notice"
      role="status"
    >
      <Badge size="sm" variant="subtle">
        Previous submission
      </Badge>
      <Text fontSize="12.5px" color="fg.muted">
        This is the result of the query you last ran, not of the query in the
        editor.
      </Text>
    </HStack>
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
      align="center"
      role="status"
      data-testid="governed-sql-truncation-banner"
    >
      <Badge size="sm" variant="subtle" colorPalette="orange">
        Partial result
      </Badge>
      <Text fontSize="12.5px" color="fg.muted">
        Showing the first {formatNumber(result.statistics.rowsReturned)} rows.
        The rest of the answer did not fit in the response — aggregate or narrow
        the query to see it.
      </Text>
    </HStack>
  );
}

export function GovernedSqlResultPane({
  state,
  chartSlot,
}: GovernedSqlResultPaneProps) {
  const stale = isGovernedSqlResultStale(state);
  const failure =
    state.outcome?.kind === "error"
      ? readGovernedSqlFailure(state.outcome.error)
      : undefined;
  const result =
    state.outcome?.kind === "result" ? state.outcome.result : undefined;

  return (
    <VStack
      align="stretch"
      gap={3}
      width="full"
      data-testid="governed-sql-result-pane"
    >
      {stale && <StaleNotice />}

      {state.inFlight && (
        <HStack gap={2} color="fg.muted" data-testid="governed-sql-loading">
          <Spinner size="sm" />
          <Text fontSize="13px">Running the query</Text>
        </HStack>
      )}

      {!state.inFlight && state.outcome === null && (
        <Text fontSize="13px" color="fg.muted">
          Run a query to see its result here.
        </Text>
      )}

      {state.outcome?.kind === "error" && failure && (
        <Stack gap={2}>
          <HandledErrorAlert
            error={state.outcome.error}
            fallbackTitle="Couldn't run the query"
          />
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
      )}

      {result && (
        <>
          {result.truncated && <TruncationBanner result={result} />}

          <Tabs.Root
            defaultValue={DEFAULT_RESULT_MODE}
            size="sm"
            variant="line"
            width="full"
          >
            <Tabs.List>
              <Tabs.Trigger value="table">Table</Tabs.Trigger>
              <Tabs.Trigger value="chart">Chart</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="table" paddingX={0}>
              <GovernedSqlResultTable result={result} />
            </Tabs.Content>
            <Tabs.Content value="chart" paddingX={0}>
              {chartSlot}
            </Tabs.Content>
          </Tabs.Root>

          {/* Outside the panels: both belong to the result, not to a reading
              of it, so neither mode can be the reason one goes unread. */}
          <GovernedSqlResultMeta statistics={result.statistics} />
          <GovernedSqlDiagnostics diagnostics={result.diagnostics} />
        </>
      )}
    </VStack>
  );
}
