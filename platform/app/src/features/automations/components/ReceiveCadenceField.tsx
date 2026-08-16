import { Field, HStack, NativeSelect, Stack, Text } from "@chakra-ui/react";
import {
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "@langwatch/automations/cadences";
import { useState } from "react";
import { Radio, RadioGroup } from "~/components/ui/radio";

type DigestCadence = Exclude<NotificationCadence, "immediate">;

// Exhaustive over the cadence contract: a new digest cadence fails typecheck
// here instead of silently missing from the window picker.
const WINDOW_LABELS: Record<DigestCadence, string> = {
  "5min_digest": "every 5 minutes",
  "15min_digest": "every 15 minutes",
  hourly_digest: "every hour",
};

const WINDOW_OPTIONS: Array<{ value: DigestCadence; label: string }> =
  NOTIFICATION_CADENCES.filter(
    (cadence): cadence is DigestCadence => cadence !== "immediate",
  ).map((value) => ({ value, label: WINDOW_LABELS[value] }));

/**
 * The notification cadence phrased as the question the author is answering:
 * one message per matching trace, or batched on a schedule. Notify actions
 * only — the surfaces that render it already gate on `isNotifyAction`, so no
 * internal gate. The router silently coerces persist-action cadence writes to
 * "immediate", so the value can sit dormant in the draft while a user is
 * type-switching.
 *
 * A channel whose templates depend on this choice hosts the field itself,
 * beside the templates it filters (`ClientDef.hasOwnReceiveChooser`); every
 * other notify channel gets it from the cadence facet.
 */
export function ReceiveCadenceField({
  value,
  onChange,
}: {
  value: NotificationCadence;
  onChange: (value: NotificationCadence) => void;
}) {
  // Flipping to per-trace and back returns the author to the batch window
  // they had, not to a hardcoded default.
  const [lastWindow, setLastWindow] = useState<DigestCadence>(
    value === "immediate" ? "5min_digest" : value,
  );
  const isBatched = value !== "immediate";

  return (
    <Field.Root>
      <Field.Label>How do you want to receive messages?</Field.Label>
      <RadioGroup
        value={isBatched ? "batches" : "immediate"}
        onValueChange={({ value: mode }) => {
          if (mode === "immediate") {
            if (value !== "immediate") setLastWindow(value);
            onChange("immediate");
          }
          if (mode === "batches") onChange(lastWindow);
        }}
      >
        <Stack gap={1.5} align="stretch">
          <Radio value="immediate">One message per matching trace</Radio>
          <HStack gap={2}>
            <Radio value="batches">In batches,</Radio>
            <NativeSelect.Root size="xs" width="auto" disabled={!isBatched}>
              <NativeSelect.Field
                aria-label="Batch window"
                value={isBatched ? value : lastWindow}
                onChange={(e) => {
                  const next = e.target.value as DigestCadence;
                  setLastWindow(next);
                  onChange(next);
                }}
              >
                {WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </HStack>
        </Stack>
      </RadioGroup>
      <Text textStyle="xs" color="fg.muted" mt={1}>
        {isBatched
          ? "Matches are collected and sent together as one message at the end of each window. A window with no matches sends nothing."
          : "Each matching trace sends its own message — once the trace has settled, not the instant it arrives."}
      </Text>
    </Field.Root>
  );
}
