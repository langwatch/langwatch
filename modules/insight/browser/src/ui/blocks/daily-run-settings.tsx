/**
 * What a board's daily run carries, as one sentence with its three choices in place: the
 * hour it starts around, the time zone that hour is in, and the most it files. The offer
 * and a board's settings set a run with this one group.
 */

import { Box, NativeSelect, Text } from "@langwatch/design-system/primitives";
import type { InsightRunSettings } from "@langwatch/insight-contract";
import type { ReactNode } from "react";

import {
  hourWords,
  RUN_HOURS,
  RUN_MAXIMUMS,
  runMaximum,
  zoneChoices,
  zoneLabel,
} from "../../model/daily-run.ts";

export function DailyRunSettings({
  value,
  ownTimezone,
  now,
  onChange,
}: {
  value: InsightRunSettings;
  /** The reader's own zone, listed first. */
  ownTimezone: string;
  /** The clock the zones' offsets are read at. */
  now: number;
  onChange: (next: InsightRunSettings) => void;
}) {
  const zones = zoneChoices({ own: ownTimezone, current: value.timezone });
  return (
    <Box as="fieldset" aria-label="Daily run" minWidth={0} border={0} padding={0}>
      {/* Tall lines, so wrapped choices do not touch. A div, because a select's frame is one. */}
      <Box fontSize="13px" lineHeight="2.3">
        <Box as="span" whiteSpace="nowrap">
          Run every day around{" "}
          <Choice
            label="Run time"
            value={String(value.hour)}
            onChange={(hour) => onChange({ ...value, hour: Number(hour) })}
          >
            {RUN_HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourWords(hour)}
              </option>
            ))}
          </Choice>
        </Box>{" "}
        <Choice
          label="Time zone"
          value={value.timezone}
          onChange={(timezone) => onChange({ ...value, timezone })}
        >
          <optgroup label="Your time zone">
            <option value={zones.own}>{zoneLabel({ zone: zones.own, now })}</option>
          </optgroup>
          <optgroup label="Other time zones">
            {zones.others.map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabel({ zone, now })}
              </option>
            ))}
          </optgroup>
        </Choice>{" "}
        <Box as="span" whiteSpace="nowrap">
          and file at most{" "}
          <Choice
            label="Most insights per run"
            value={String(value.maxInsights)}
            onChange={(most) => onChange({ ...value, maxInsights: runMaximum(Number(most)) })}
          >
            {RUN_MAXIMUMS.map((most) => (
              <option key={most} value={most}>
                {most}
              </option>
            ))}
          </Choice>{" "}
          {value.maxInsights === 1 ? "insight" : "insights"}.
        </Box>
      </Box>
      <Text marginTop={1} fontSize="12px" lineHeight="relaxed" color="fg.muted">
        On a quiet day Langy files nothing, and the board says so.
      </Text>
    </Box>
  );
}

/** One choice inside the sentence: a native select, drawn small and no wider than its value. */
function Choice({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <NativeSelect.Root size="xs" display="inline-block" width="auto" verticalAlign="baseline">
      <NativeSelect.Field
        aria-label={label}
        value={value}
        fontWeight="medium"
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}
