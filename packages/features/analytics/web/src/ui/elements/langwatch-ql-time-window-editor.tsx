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
 * @see @langwatch/analytics-contract — the contract this fills
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { Box, Button, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";

// The leaf module, never the barrel: `timeWindow.ts` is import-free precisely
// so the browser can read the same names and format the database is bound with,
// while the barrel would drag the executor and the remediation registry in with
// it.
import {
  formatLangWatchQLDateTimeParameter,
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_START_PARAMETER,
} from "@langwatch/analytics-contract";

import type { LangWatchQLTimeWindowValues } from "../../model/lwql-request-state";

/** What a member may type, as UTC: a date, or a date and a time. */
const TYPED_INSTANT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * A typed instant as epoch milliseconds, or `undefined` when it is not one yet.
 *
 * Read as UTC, matching what is displayed and what the database is bound with.
 * Reading it in the browser's zone would mean the member's own text meant
 * something different from the identical text in their `WHERE` clause.
 *
 * The shape alone is not enough to accept it. `Date.UTC` rolls an out-of-range
 * part over without a word — `2026-13-45` is the 14th of February 2027, and
 * `2026-02-30 99:00` the 6th of March — so the window committed would be one
 * the member never typed, with the field showing nothing wrong. Requiring the
 * parsed instant to format back to the text that produced it is what refuses
 * them.
 *
 * That also covers the halfway states of typing, which the shape check misses
 * for the same reason: `2026-02-24 09:60` is a complete shape a member reaches
 * while spelling out a minute, and it parses to ten o'clock — an hour that was
 * never on screen.
 */
export function parseLangWatchQLTimeWindowText(text: string): number | undefined {
  const match = TYPED_INSTANT.exec(text.trim());
  if (!match) return void 0;
  // An absent group is `undefined`, so a date with no time means midnight —
  // which is what the member reads, since that is how the fields spell it back.
  const [, year, month, day, hours = "00", minutes = "00", seconds = "00"] = match;
  const parsed = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
  if (Number.isNaN(parsed)) return void 0;

  const typed = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  return formatLangWatchQLDateTimeParameter(new Date(parsed)) === typed ? parsed : void 0;
}

interface WindowText {
  readonly start: string;
  readonly end: string;
}

function textOf(window: LangWatchQLTimeWindowValues): WindowText {
  return {
    start: formatLangWatchQLDateTimeParameter(new Date(window.start)),
    end: formatLangWatchQLDateTimeParameter(new Date(window.end)),
  };
}

export interface LangWatchQLTimeWindowEditorProps {
  /** The window that will be sent: the page's period, or the member's override. */
  value: LangWatchQLTimeWindowValues;
  /** Whether the member is holding a one-off override of the page's period. */
  overridden: boolean;
  onOverride: (timeWindow: LangWatchQLTimeWindowValues) => void;
  /** Drops the override, so the window follows the page's period again. */
  onFollowPage: () => void;
  /**
   * Whether the statement that produced the visible answer declared the
   * reserved names. `undefined` before anything has run — only the backend
   * knows, and the browser deliberately does not parse SQL to guess.
   */
  followsTimeWindow?: boolean | undefined;
  /**
   * Told whether the visible text names a sendable window — both fields parse
   * and the start precedes the end. While it is `false` the last committed
   * window no longer matches what is on screen, and the caller must hold Run
   * rather than execute a window the member is no longer looking at.
   */
  onSendableChange: (sendable: boolean) => void;
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
  const invalid = parseLangWatchQLTimeWindowText(text) === void 0;

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
      {`This query does not use the time window. Declare {${LWQL_PERIOD_START_PARAMETER}:DateTime} and {${LWQL_PERIOD_END_PARAMETER}:DateTime} and the page fills them with the period it is showing, then compare against them to report over it.`}
    </Text>
  );
}

export function LangWatchQLTimeWindowEditor({
  value,
  overridden,
  onOverride,
  onFollowPage,
  followsTimeWindow,
  onSendableChange,
}: LangWatchQLTimeWindowEditorProps) {
  const displayed = textOf(value);
  const [text, setText] = useState<WindowText>(displayed);
  const [shown, setShown] = useState<WindowText>(displayed);

  // The window moved underneath the member — the page's period changed, or they
  // dropped their override — so what the fields show has to move with it.
  // Derived during render rather than in an effect, so the fields never paint
  // one window while the request would carry another. The one divergence left
  // is the member's own typing, and `onSendableChange` below is what keeps it
  // from executing.
  if (shown.start !== displayed.start || shown.end !== displayed.end) {
    setShown(displayed);
    setText(displayed);
  }

  const startInstant = parseLangWatchQLTimeWindowText(text.start);
  const endInstant = parseLangWatchQLTimeWindowText(text.end);
  // Its own answer rather than folded into per-field validity, because it
  // needs its own words: both fields are fine on their own.
  const inverted = startInstant !== void 0 && endInstant !== void 0 && startInstant >= endInstant;
  const sendable = startInstant !== void 0 && endInstant !== void 0 && !inverted;

  useEffect(() => {
    onSendableChange(sendable);
  }, [onSendableChange, sendable]);

  const change = (next: WindowText) => {
    setText(next);
    const start = parseLangWatchQLTimeWindowText(next.start);
    const end = parseLangWatchQLTimeWindowText(next.end);
    if (start !== void 0 && end !== void 0 && start < end) onOverride({ start, end });
  };

  return (
    <Stack gap={2} width="full" data-testid="lwql-time-window">
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
          name={LWQL_PERIOD_START_PARAMETER}
          text={text.start}
          onText={(start) => change({ ...text, start })}
        />
        <InstantField
          name={LWQL_PERIOD_END_PARAMETER}
          text={text.end}
          onText={(end) => change({ ...text, end })}
        />
      </HStack>

      {inverted && (
        <Text fontSize="12px" color="red.fg" data-testid="inverted-time-window">
          The start must be before the end.
        </Text>
      )}

      <Text fontSize="12px" color="fg.muted">
        Values are UTC, and the period is half-open — write{" "}
        {`>= {${LWQL_PERIOD_START_PARAMETER}:DateTime} AND < {${LWQL_PERIOD_END_PARAMETER}:DateTime}`}
        .
      </Text>

      <FollowsPeriodNote follows={followsTimeWindow} />
    </Stack>
  );
}
