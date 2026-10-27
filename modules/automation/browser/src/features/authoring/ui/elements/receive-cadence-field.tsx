import { NOTIFICATION_CADENCES, type NotificationCadence } from "@langwatch/automation-contract";
import { Field, HStack, NativeSelect, Stack, Text } from "@langwatch/design-system/primitives";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { useState } from "react";

type DigestCadence = Exclude<NotificationCadence, "immediate">;

// Exhaustive over the cadence contract: a new digest cadence fails typecheck
// here instead of silently missing from the window picker.
const WINDOW_LABELS: Record<DigestCadence, string> = {
  "5min_digest": "every 5 minutes",
  "15min_digest": "every 15 minutes",
  hourly_digest: "every hour",
};

const WINDOW_OPTIONS: { value: DigestCadence; label: string }[] = NOTIFICATION_CADENCES.filter(
  (cadence): cadence is DigestCadence => cadence !== "immediate",
).map((value) => ({ value, label: WINDOW_LABELS[value] }));

/**
 * The notification cadence as the author's question: one message per matching trace, or
 * batched. Notify actions only (callers gate on `isNotifyAction`). A channel with its own
 * `hasOwnReceiveChooser` hosts it; every other notify channel gets it from the cadence facet.
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
                  const next = WINDOW_OPTIONS.find((opt) => opt.value === e.target.value)?.value;
                  if (!next) return;
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
          : "Each matching trace sends its own message once the trace has settled, not the instant it arrives."}
      </Text>
    </Field.Root>
  );
}
