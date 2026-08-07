/**
 * The period a submission reports over.
 *
 * Two values that look like parameters and deliberately are not: `period_start`
 * and `period_end` are supplied by whatever surface is showing the chart, and
 * the backend refuses a request that sends either among its own named
 * parameters. That is what makes a workbench-authored chart follow a dashboard
 * once it is placed on one — and why a member's one-off override adjusts the
 * *window* rather than pinning a parameter value that would then ignore the
 * dashboard.
 *
 * Shown in the same form as the database is bound with, `YYYY-MM-DD HH:MM:SS`
 * in UTC, so that what a member reads here and what their `WHERE` clause
 * compares against are the same string.
 *
 * @see ~/server/analytics/governed-sql/timeWindow — the contract this fills
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Box, Button, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";

// The leaf module, never the barrel: `timeWindow.ts` is import-free precisely
// so the browser can read the same names and format the database is bound with,
// while the barrel would drag the executor and the remediation registry in with
// it.
import {
  formatGovernedDateTimeParameter,
  GOVERNED_SQL_PERIOD_END_PARAMETER,
  GOVERNED_SQL_PERIOD_START_PARAMETER,
} from "~/server/analytics/governed-sql/timeWindow";

import type { GovernedSqlTimeWindowValues } from "../logic/governedSqlRequestState";

/** What a member may type, as UTC: a date, or a date and a time. */
const TYPED_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * A typed instant as epoch milliseconds, or `undefined` when it is not one yet.
 *
 * Read as UTC, matching what is displayed and what the database is bound with.
 * Reading it in the browser's zone would mean the member's own text meant
 * something different from the identical text in their `WHERE` clause.
 */
export function parseGovernedSqlTimeWindowText(
  text: string,
): number | undefined {
  const match = TYPED_INSTANT.exec(text.trim());
  if (!match) return undefined;
  const [, year, month, day, hours, minutes, seconds] = match;
  const parsed = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours ?? 0),
    Number(minutes ?? 0),
    Number(seconds ?? 0),
  );
  return Number.isNaN(parsed) ? undefined : parsed;
}

interface WindowText {
  readonly start: string;
  readonly end: string;
}

function textOf(window: GovernedSqlTimeWindowValues): WindowText {
  return {
    start: formatGovernedDateTimeParameter(new Date(window.start)),
    end: formatGovernedDateTimeParameter(new Date(window.end)),
  };
}

export interface GovernedSqlTimeWindowEditorProps {
  /** The window that will be sent: the page's period, or the member's override. */
  value: GovernedSqlTimeWindowValues;
  /** Whether the member is holding a one-off override of the page's period. */
  overridden: boolean;
  onOverride: (timeWindow: GovernedSqlTimeWindowValues) => void;
  /** Drops the override, so the window follows the page's period again. */
  onFollowPage: () => void;
  /**
   * Whether the statement that produced the visible answer declared the
   * reserved names. `undefined` before anything has run — only the backend
   * knows, and the browser deliberately does not parse SQL to guess.
   */
  followsTimeWindow?: boolean | undefined;
}

function InstantField({
  name,
  text,
  onText,
}: {
  name: string;
  text: string;
  onText: (text: string) => void;
}) {
  const invalid = parseGovernedSqlTimeWindowText(text) === undefined;

  return (
    <Stack gap={1} flex="1" minWidth="180px">
      <Text fontSize="12px" color="fg.muted" fontFamily="mono">
        {`{${name}:DateTime}`}
      </Text>
      <Input
        size="sm"
        aria-label={name}
        placeholder="YYYY-MM-DD HH:MM:SS"
        value={text}
        onChange={(event) => onText(event.target.value)}
      />
      {invalid && (
        <Text fontSize="12px" color="red.fg">
          Enter a date and time, like 2026-02-20 12:00:00.
        </Text>
      )}
    </Stack>
  );
}

/**
 * Said out loud rather than left to be noticed: a chart that ignores the period
 * sitting beside one that follows it is the failure this whole contract exists
 * to prevent, and silence is what lets it happen.
 */
function FollowsPeriodNote({ follows }: { follows: boolean | undefined }) {
  if (follows !== false) return null;

  return (
    <Text fontSize="12px" color="fg.muted" data-testid="does-not-follow-period">
      {`This query does not use the time window. Declare {${GOVERNED_SQL_PERIOD_START_PARAMETER}:DateTime} and {${GOVERNED_SQL_PERIOD_END_PARAMETER}:DateTime} to follow the period of the page it is shown on.`}
    </Text>
  );
}

export function GovernedSqlTimeWindowEditor({
  value,
  overridden,
  onOverride,
  onFollowPage,
  followsTimeWindow,
}: GovernedSqlTimeWindowEditorProps) {
  const displayed = textOf(value);
  const [text, setText] = useState<WindowText>(displayed);
  const [shown, setShown] = useState<WindowText>(displayed);

  // The window moved underneath the member — the page's period changed, or they
  // dropped their override — so what the fields show has to move with it.
  // Derived during render rather than in an effect, so the fields never paint
  // one window while the request would carry another.
  if (shown.start !== displayed.start || shown.end !== displayed.end) {
    setShown(displayed);
    setText(displayed);
  }

  const change = (next: WindowText) => {
    setText(next);
    const start = parseGovernedSqlTimeWindowText(next.start);
    const end = parseGovernedSqlTimeWindowText(next.end);
    if (start !== undefined && end !== undefined) onOverride({ start, end });
  };

  return (
    <Stack gap={2} width="full" data-testid="governed-sql-time-window">
      <HStack gap={2}>
        <Text fontSize="13px" fontWeight="600">
          Time window
        </Text>
        <Text fontSize="12px" color="fg.muted">
          {overridden ? "Set for this query" : "From the period on this page"}
        </Text>
        <Box flex="1" />
        {overridden && (
          <Button size="xs" variant="outline" onClick={onFollowPage}>
            Use the page period
          </Button>
        )}
      </HStack>

      <HStack gap={2} align="start" flexWrap="wrap">
        <InstantField
          name={GOVERNED_SQL_PERIOD_START_PARAMETER}
          text={text.start}
          onText={(start) => change({ ...text, start })}
        />
        <InstantField
          name={GOVERNED_SQL_PERIOD_END_PARAMETER}
          text={text.end}
          onText={(end) => change({ ...text, end })}
        />
      </HStack>

      <Text fontSize="12px" color="fg.muted">
        Values are UTC, and the period is half-open — write{" "}
        {`>= {${GOVERNED_SQL_PERIOD_START_PARAMETER}:DateTime} AND < {${GOVERNED_SQL_PERIOD_END_PARAMETER}:DateTime}`}
        .
      </Text>

      <FollowsPeriodNote follows={followsTimeWindow} />
    </Stack>
  );
}
