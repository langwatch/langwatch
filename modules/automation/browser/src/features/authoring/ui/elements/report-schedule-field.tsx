import { Field, HStack, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { Switch } from "@langwatch/design-system/switch";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  cronFromParts,
  cronScheduleError,
  DEFAULT_PARTS,
  defaultTimezone,
  describeCron,
  FREQUENCY_LABELS,
  type Frequency,
  groupTimezones,
  ordinal,
  partsFromCron,
  type ScheduleParts,
  summarizeSchedule,
  supportedTimezones,
  timeOfDay,
  WEEKDAY_OPTIONS,
} from "../../model/report-schedule.ts";

const FREQUENCIES: Frequency[] = ["daily", "weekly", "monthly"];
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

type TimeOfDayRead = { kind: "time"; hour: number; minute: number } | { kind: "invalid" };

/** `HH:MM` from the time input; anything else, or an out-of-range value, is invalid. */
function readTimeOfDay(value: string): TimeOfDayRead {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return { kind: "invalid" };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return { kind: "invalid" };
  return { kind: "time", hour, minute };
}

function CronExpressionField({
  cron,
  cronError,
  onChange,
}: {
  cron: string;
  cronError: string | null;
  onChange: (cron: string) => void;
}) {
  return (
    <Field.Root invalid={cronError !== null}>
      <Field.Label>Cron expression</Field.Label>
      <Input
        fontFamily="mono"
        value={cron}
        placeholder="0 9 * * 1"
        onChange={(e) => onChange(e.target.value)}
      />
      <Field.HelperText>
        Five fields: minute, hour, day-of-month, month, day-of-week.
      </Field.HelperText>
      {cronError !== null ? <Field.ErrorText>{cronError}</Field.ErrorText> : null}
    </Field.Root>
  );
}

/**
 * Schedule picker: frequency + time-of-day (day for weekly/monthly). Unknown cron opens editor.
 */
export function ReportScheduleField({
  cron,
  timezone,
  onChange,
  isEdit,
}: {
  cron: string;
  timezone: string;
  onChange: (next: { cron: string; timezone: string }) => void;
  isEdit: boolean;
}) {
  // A cron we can't map to the friendly picker opens Advanced so the value is
  // still editable rather than clobbered by the defaults.
  const [advanced, setAdvanced] = useState(() => partsFromCron(cron) === null);

  const parts = useMemo(() => partsFromCron(cron) ?? DEFAULT_PARTS, [cron]);

  const zones = useMemo(() => supportedTimezones(), []);
  const groups = useMemo(() => groupTimezones(zones), [zones]);
  const currentTzMissing = timezone.trim() !== "" && !zones.includes(timezone);

  // New reports adopt the viewer's locale timezone instead of the stale "UTC"
  // default, and persist it up so the saved schedule matches what the summary
  // shows. Editing an existing report never clobbers its stored timezone.
  const tzInitialized = useRef(false);
  useEffect(() => {
    if (tzInitialized.current) return;
    tzInitialized.current = true;
    if (isEdit) return;
    if (timezone.trim() !== "" && timezone !== "UTC") return;
    const local = defaultTimezone();
    if (local && local !== timezone) {
      onChange({ cron, timezone: local });
    }
    // Run once on mount; the guards above make repeat emits impossible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitParts = (next: Partial<ScheduleParts>) => {
    onChange({ cron: cronFromParts({ ...parts, ...next }), timezone });
  };

  const onToggleAdvanced = (toAdvanced: boolean) => {
    // Leaving Advanced with an unparseable cron re-syncs to the friendly
    // default so the picker and the value can't disagree.
    if (!toAdvanced) {
      onChange({ cron: cronFromParts(parts), timezone });
    }
    setAdvanced(toAdvanced);
  };

  const onTimeChange = (value: string) => {
    const time = readTimeOfDay(value);
    if (time.kind === "time") emitParts({ hour: time.hour, minute: time.minute });
  };

  // The friendly picker can only emit schedules we already accept, so only the
  // raw editor can produce one the scheduler would choke on.
  const cronError = advanced ? cronScheduleError({ cron, timezone }) : null;

  return (
    <VStack align="stretch" gap={4}>
      <HStack justify="flex-end" gap={2}>
        <Text textStyle="sm" color="fg.muted">
          Edit as a cron expression
        </Text>
        <Switch
          checked={advanced}
          onCheckedChange={({ checked }) => onToggleAdvanced(checked)}
          inputProps={{ "aria-label": "Edit as a cron expression" }}
        />
      </HStack>

      {advanced ? (
        <CronExpressionField
          cron={cron}
          cronError={cronError}
          onChange={(next) => onChange({ cron: next, timezone })}
        />
      ) : (
        <VStack align="stretch" gap={4}>
          <HStack gap={3} align="flex-start">
            <Field.Root flex="1">
              <Field.Label>Frequency</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={parts.frequency}
                  onChange={(e) => emitParts({ frequency: e.target.value as Frequency })}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root flex="1">
              <Field.Label>Time</Field.Label>
              <Input
                type="time"
                value={timeOfDay(parts)}
                onChange={(e) => onTimeChange(e.target.value)}
              />
            </Field.Root>
          </HStack>

          {parts.frequency === "weekly" ? (
            <Field.Root>
              <Field.Label>Day of week</Field.Label>
              <SegmentedControl
                size="sm"
                value={String(parts.dayOfWeek)}
                onValueChange={({ value }) => emitParts({ dayOfWeek: Number(value) })}
                items={WEEKDAY_OPTIONS.map((d) => ({
                  value: String(d.value),
                  label: d.short,
                }))}
              />
            </Field.Root>
          ) : null}

          {parts.frequency === "monthly" ? (
            <Field.Root>
              <Field.Label>Day of month</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={String(parts.dayOfMonth)}
                  onChange={(e) => emitParts({ dayOfMonth: Number(e.target.value) })}
                >
                  {DAYS_OF_MONTH.map((d) => (
                    <option key={d} value={d}>
                      {ordinal(d)}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
          ) : null}
        </VStack>
      )}

      <Field.Root>
        <Field.Label>Timezone</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={timezone}
            onChange={(e) => onChange({ cron, timezone: e.target.value })}
          >
            {currentTzMissing ? <option value={timezone}>{timezone}</option> : null}
            {groups.map((group) => (
              <optgroup key={group.region} label={group.region}>
                {group.zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>

      <Text textStyle="sm" color="fg.muted">
        {advanced ? describeCron(cron, timezone) : summarizeSchedule(parts, timezone)}
      </Text>
    </VStack>
  );
}
