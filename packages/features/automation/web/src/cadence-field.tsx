import { createListCollection, Field, Text } from "@chakra-ui/react";
import {
  CADENCE_LABELS,
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "@langwatch/automation-contract";
import { Select } from "@langwatch/design-system/select";
import { useMemo } from "react";

const CADENCE_OPTIONS = NOTIFICATION_CADENCES.map((value) => ({
  value,
  label: CADENCE_LABELS[value],
}));

export function AutomationCadenceField({
  value,
  onValueChange,
}: {
  value: NotificationCadence;
  onValueChange(value: NotificationCadence): void;
}) {
  const collection = useMemo(() => createListCollection({ items: CADENCE_OPTIONS }), []);

  return (
    <Field.Root>
      <Field.Label>Cadence</Field.Label>
      <Select.Root
        collection={collection}
        value={[value]}
        onValueChange={({ value: nextValues }) => {
          const next = nextValues[0];
          if (next) onValueChange(next as NotificationCadence);
        }}
      >
        <Select.Trigger>
          <Select.ValueText />
        </Select.Trigger>
        <Select.Content>
          {CADENCE_OPTIONS.map((option) => (
            <Select.Item key={option.value} item={option}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Text textStyle="xs" color="fg.muted" mt={1}>
        {value === "immediate"
          ? "Fires one notification per matching trace."
          : "Batches matches in the window into a single digest."}
      </Text>
    </Field.Root>
  );
}
