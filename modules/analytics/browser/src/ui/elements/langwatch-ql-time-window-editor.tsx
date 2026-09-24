/**
 * The period a submission reports over. `period_start`/`period_end` are NOT parameters --
 * the backend refuses either as a named parameter, so an override adjusts the *window*, not a
 * pinned value. Shown as `YYYY-MM-DD HH:MM:SS` UTC, matching what a `WHERE` clause compares.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { Box, Button, HStack, Input, Stack, Text } from "@chakra-ui/react";
// The leaf module, never the barrel: `timeWindow.ts` is import-free precisely
// so the browser can read the same names and format the database is bound with,
// while the barrel would drag the executor and the remediation registry in with
// it.
import {
  formatLangWatchQLDateTimeParameter,
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_START_PARAMETER,
} from "@langwatch/analytics-contract";
import { Temporal, toDate } from "@langwatch/time";
import { useEffect, useState } from "react";

import type { LangWatchQLTimeWindowValues } from "../../model/lwql-request-state.ts";

/** What a member may type, as UTC: a date, or a date and a time. */
const TYPED_INSTANT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * A typed instant as epoch milliseconds, or `undefined`, read as UTC to match the database.
 * Shape alone isn't enough: an out-of-range part is silently clamped, so the parsed
 * instant must format back to the text that produced it, or it is refused (catches `09:60` too).
 */
export function parseLangWatchQLTimeWindowText(text: string): number | undefined {
  const match = TYPED_INSTANT.exec(text.trim());
  if (!match) return void 0;
  // An absent group is `undefined`, so a date with no time means midnight —
  // which is what the member reads, since that is how the fields spell it back.
  const [, year, month, day, hours = "00", minutes = "00", seconds = "00"] = match;
  if (Number(month) < 1 || Number(day) < 1) return void 0;
  const parsed = Temporal.PlainDateTime.from({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hours),
    minute: Number(minutes),
    second: Number(seconds),
  }).toZonedDateTime("UTC").epochMilliseconds;

  const typed = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  const spelledBack = formatLangWatchQLDateTimeParameter(
    toDate(Temporal.Instant.fromEpochMilliseconds(parsed)),
  );
  return spelledBack === typed ? parsed : void 0;
}

interface WindowText {
  readonly start: string;
  readonly end: string;
}

function textOf(window: LangWatchQLTimeWindowValues): WindowText {
  return {
    start: formatLangWatchQLDateTimeParameter(
      toDate(Temporal.Instant.fromEpochMilliseconds(window.start)),
    ),
    end: formatLangWatchQLDateTimeParameter(
      toDate(Temporal.Instant.fromEpochMilliseconds(window.end)),
    ),
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
   * Told whether the visible text names a sendable window -- both fields parse and start
   * precedes end. While `false`, the last committed window no longer matches the screen, so
   * the caller must hold Run rather than execute a window the member isn't looking at.
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

  // The window moved underneath the member -- period changed, or they dropped their override --
  // so the fields must move with it. Derived during render, not an effect, so fields never paint
  // one window while the request carries another; `onSendableChange` guards the member's typing.
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
        Values are UTC, and the period is half-open: write{" "}
        {`>= {${LWQL_PERIOD_START_PARAMETER}:DateTime} AND < {${LWQL_PERIOD_END_PARAMETER}:DateTime}`}
        .
      </Text>

      <FollowsPeriodNote follows={followsTimeWindow} />
    </Stack>
  );
}
