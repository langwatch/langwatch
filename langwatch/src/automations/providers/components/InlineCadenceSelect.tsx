import { createListCollection, Field, HStack, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { Select } from "~/components/ui/select";
import {
  CADENCE_LABELS,
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/automations/cadences";

const CADENCE_OPTIONS = NOTIFICATION_CADENCES.map((value) => ({
  value,
  label: CADENCE_LABELS[value],
}));

/**
 * Inline cadence selector for notify provider ConfigForms. Cadence affects
 * which template variables are available (digest exposes `digest.windowStart`
 * etc.) — exposing the switch here saves the author a round-trip to the
 * cadence secondary drawer. Decoupled from the automations feature store so
 * providers stay portable; the parent ConfigFormCtx wires the value and
 * setter through.
 */
export function InlineCadenceSelect({
  value,
  onChange,
}: {
  value: NotificationCadence;
  onChange: (next: NotificationCadence) => void;
}) {
  const collection = useMemo(
    () => createListCollection({ items: CADENCE_OPTIONS }),
    [],
  );

  return (
    <Field.Root>
      <Field.Label>
        <HStack gap={2}>
          <Text>Cadence</Text>
          <Text textStyle="xs" color="fg.muted">
            Affects which variables your template can use.
          </Text>
        </HStack>
      </Field.Label>
      <Select.Root
        collection={collection}
        value={[value]}
        onValueChange={({ value: next }) => {
          const picked = next[0] as NotificationCadence | undefined;
          if (picked) onChange(picked);
        }}
      >
        <Select.Trigger>
          <Select.ValueText />
        </Select.Trigger>
        <Select.Content>
          {CADENCE_OPTIONS.map((opt) => (
            <Select.Item key={opt.value} item={opt}>
              {opt.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Field.Root>
  );
}
