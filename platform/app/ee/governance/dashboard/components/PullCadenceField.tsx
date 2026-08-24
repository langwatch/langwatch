// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Switch } from "~/components/ui/switch";
import {
  timeOfDay,
  WEEKDAY_OPTIONS,
} from "~/features/automations/logic/reportSchedule";
import {
  cronFromPullParts,
  type PullCadenceParts,
  type PullFrequency,
  partsFromPullCron,
  pullCadenceCronError,
  recommendedPullSchedule,
  summarizePullCadence,
} from "@langwatch/enterprise-governance-web";
import type { SourceType } from "./ingestionSourceCatalog";

/** One flat select collapses frequency + minute interval: "every 15
 *  minutes" is one thought to an admin, not two controls. */
const FREQUENCY_CHOICES: Array<{ value: string; label: string }> = [
  { value: "m5", label: "Every 5 minutes" },
  { value: "m10", label: "Every 10 minutes" },
  { value: "m15", label: "Every 15 minutes" },
  { value: "m30", label: "Every 30 minutes" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
];

function choiceFromParts(parts: PullCadenceParts): string {
  return parts.frequency === "minutes"
    ? `m${parts.everyMinutes}`
    : parts.frequency;
}

function partsFromChoice(
  choice: string,
  current: PullCadenceParts,
): PullCadenceParts {
  if (choice.startsWith("m")) {
    return {
      ...current,
      frequency: "minutes",
      everyMinutes: Number(choice.slice(1)),
    };
  }
  return { ...current, frequency: choice as PullFrequency };
}

function CadenceCronEditor({
  value,
  recommended,
  error,
  onChange,
}: {
  value: string;
  recommended: string;
  error: string | null;
  onChange: (next: string) => void;
}) {
  return (
    <Field.Root invalid={error !== null}>
      <Field.Label fontSize="xs">Cron expression</Field.Label>
      <Input
        size="sm"
        fontFamily="mono"
        value={value}
        placeholder={recommended}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== null ? (
        <Field.ErrorText fontSize="xs">{error}</Field.ErrorText>
      ) : null}
    </Field.Root>
  );
}

function CadenceMinutePastField({
  minute,
  onMinute,
}: {
  minute: number;
  onMinute: (minute: number) => void;
}) {
  return (
    <Field.Root flex="1">
      <Field.Label fontSize="xs">Minutes past the hour</Field.Label>
      <Input
        size="sm"
        type="number"
        min={0}
        max={59}
        value={minute}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isInteger(next) && next >= 0 && next <= 59) onMinute(next);
        }}
      />
    </Field.Root>
  );
}

function CadenceTimeField({
  parts,
  emitParts,
}: {
  parts: PullCadenceParts;
  emitParts: (next: Partial<PullCadenceParts>) => void;
}) {
  const onTimeChange = (timeValue: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(timeValue);
    if (!match) return;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return;
    emitParts({ hour, minute });
  };
  return (
    <Field.Root flex="1">
      <Field.Label fontSize="xs">Time (UTC)</Field.Label>
      <Input
        size="sm"
        type="time"
        value={timeOfDay(parts)}
        onChange={(e) => onTimeChange(e.target.value)}
      />
    </Field.Root>
  );
}

function CadenceFrequencyPicker({
  parts,
  emitParts,
  onPickChoice,
}: {
  parts: PullCadenceParts;
  emitParts: (next: Partial<PullCadenceParts>) => void;
  onPickChoice: (choice: string) => void;
}) {
  const isTimeOfDayVisible =
    parts.frequency === "daily" || parts.frequency === "weekly";
  return (
    <VStack align="stretch" gap={3}>
      <HStack gap={3} align="flex-start">
        <Field.Root flex="1">
          <Field.Label fontSize="xs">Frequency</Field.Label>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={choiceFromParts(parts)}
              onChange={(e) => onPickChoice(e.target.value)}
            >
              {FREQUENCY_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>

        {parts.frequency === "hourly" ? (
          <CadenceMinutePastField
            minute={parts.minute}
            onMinute={(minute) => emitParts({ minute })}
          />
        ) : null}

        {isTimeOfDayVisible ? (
          <CadenceTimeField parts={parts} emitParts={emitParts} />
        ) : null}
      </HStack>

      {parts.frequency === "weekly" ? (
        <Field.Root>
          <Field.Label fontSize="xs">Day of week</Field.Label>
          <SegmentedControl
            size="sm"
            value={String(parts.dayOfWeek)}
            onValueChange={({ value: day }) =>
              emitParts({ dayOfWeek: Number(day) })
            }
            items={WEEKDAY_OPTIONS.map((d) => ({
              value: String(d.value),
              label: d.short,
            }))}
          />
        </Field.Root>
      ) : null}
    </VStack>
  );
}

function CadenceSummary({ effectiveCron }: { effectiveCron: string }) {
  const summaryParts = partsFromPullCron(effectiveCron);
  return (
    <>
      <Text fontSize="xs" color="fg.muted">
        {summaryParts
          ? summarizePullCadence(summaryParts)
          : `Runs on the schedule ${effectiveCron}`}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        How often we check this source for new activity. Leave as-is to use the
        recommended schedule.
      </Text>
    </>
  );
}

/**
 * The Cadence section of the source composer: how often a pull-mode source
 * checks for new activity, said in plain words. Controlled like the raw
 * input it replaces: `value` is the composer's pullSchedule where "" means
 * "the recommended schedule" (resolved to an explicit cron at create — a
 * saved schedule of null would mean the source never runs), and every edit
 * comes back through `onChange` as a cron string.
 *
 * Cron editing stays behind an explicit toggle; a stored cron the picker
 * cannot express opens with the toggle already on so the value is editable
 * rather than clobbered by picker defaults. Renders nothing for source
 * types without a pull adapter.
 */
export function PullCadenceField({
  sourceType,
  value,
  onChange,
}: {
  sourceType: SourceType;
  value: string;
  onChange: (next: string) => void;
}) {
  const recommended = recommendedPullSchedule(sourceType);
  const effectiveCron = value.trim() || recommended || "";
  // A cron the picker can't say opens the cron editor so the value stays
  // editable instead of being clobbered by picker defaults.
  const [isCronMode, setIsCronMode] = useState(
    () => effectiveCron !== "" && partsFromPullCron(effectiveCron) === null,
  );

  const parts = useMemo(
    () =>
      partsFromPullCron(effectiveCron) ?? {
        frequency: "minutes" as const,
        everyMinutes: 15,
        minute: 0,
        hour: 9,
        dayOfWeek: 1,
      },
    [effectiveCron],
  );

  if (!recommended) return null;

  const emitParts = (next: Partial<PullCadenceParts>) => {
    onChange(cronFromPullParts({ ...parts, ...next }));
  };

  const onToggleCronMode = (isEnteringCronMode: boolean) => {
    // Entering cron mode makes the schedule explicit so the editor holds a
    // real value; leaving it with an unparseable cron re-syncs to the
    // friendly parts so the picker and the value can't disagree.
    if (isEnteringCronMode && value.trim() === "") {
      onChange(effectiveCron);
    }
    if (!isEnteringCronMode && partsFromPullCron(effectiveCron) === null) {
      onChange(cronFromPullParts(parts));
    }
    setIsCronMode(isEnteringCronMode);
  };

  // Blank means "the recommended schedule" and is always saveable; only a
  // typed cron can be one the scheduler would refuse.
  const cronError =
    isCronMode && value.trim() !== "" ? pullCadenceCronError(value) : null;

  return (
    <VStack align="stretch" gap={3}>
      <HStack justify="space-between" gap={2}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Cadence
        </Text>
        <HStack gap={2}>
          <Text fontSize="xs" color="fg.muted">
            Edit as a cron expression
          </Text>
          <Switch
            size="sm"
            checked={isCronMode}
            onCheckedChange={({ checked }) => onToggleCronMode(checked)}
            inputProps={{ "aria-label": "Edit as a cron expression" }}
          />
        </HStack>
      </HStack>

      {isCronMode ? (
        <CadenceCronEditor
          value={value}
          recommended={recommended}
          error={cronError}
          onChange={onChange}
        />
      ) : (
        <CadenceFrequencyPicker
          parts={parts}
          emitParts={emitParts}
          onPickChoice={(choice) =>
            onChange(cronFromPullParts(partsFromChoice(choice, parts)))
          }
        />
      )}

      <CadenceSummary effectiveCron={effectiveCron} />
    </VStack>
  );
}
